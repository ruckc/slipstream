use std::{
    collections::BTreeSet,
    env,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use axum::{extract::State, http::StatusCode, response::Response, routing::get, Router};
use chrono::Utc;
use kube::Client;
use sqlx::PgPool;
use tokio::{net::TcpListener, time};
use tracing::{info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use uuid::Uuid;

mod cadvisor;
mod k8s;
mod scrape;
mod store;

// ---------------------------------------------------------------------------
// Shared collector state (for /metrics self-reporting / readiness)
// ---------------------------------------------------------------------------

struct CollectorState {
    last_scrape_ms: AtomicU64,
    last_pod_count: AtomicU64,
}

#[tokio::main]
async fn main() -> Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("ring crypto provider already installed");

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer().json())
        .init();

    let database_url =
        env::var("DATABASE_URL").context("DATABASE_URL environment variable is required")?;
    let metrics_token =
        env::var("METRICS_TOKEN").context("METRICS_TOKEN environment variable is required")?;
    let node_name = env::var("NODE_NAME").context("NODE_NAME environment variable is required")?;
    let scrape_interval_secs: u64 = env::var("SCRAPE_INTERVAL_SECONDS")
        .unwrap_or_else(|_| "60".to_string())
        .parse()
        .context("Invalid SCRAPE_INTERVAL_SECONDS")?;
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .context("Invalid PORT")?;

    info!(
        node_name,
        scrape_interval_secs, "metrics-collector starting (node-local DaemonSet)"
    );

    let pool = PgPool::connect(&database_url)
        .await
        .context("connect to Postgres")?;
    let k8s_client = Client::try_default()
        .await
        .context("build Kubernetes client")?;
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let state = Arc::new(CollectorState {
        last_scrape_ms: AtomicU64::new(0),
        last_pod_count: AtomicU64::new(0),
    });

    let loop_state = state.clone();
    tokio::spawn(scrape_loop(
        pool,
        k8s_client,
        http_client,
        node_name,
        scrape_interval_secs,
        metrics_token,
        loop_state,
    ));

    let app = Router::new()
        .route("/metrics", get(metrics_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).await?;
    info!("Listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut sigterm = signal(SignalKind::terminate()).expect("failed to register SIGTERM handler");
    let mut sigint = signal(SignalKind::interrupt()).expect("failed to register SIGINT handler");
    tokio::select! {
        _ = sigterm.recv() => { info!("received SIGTERM, shutting down"); }
        _ = sigint.recv() => { info!("received SIGINT, shutting down"); }
    }
}

// ---------------------------------------------------------------------------
// Scrape loop — node-local, no sharding
// ---------------------------------------------------------------------------

async fn scrape_loop(
    pool: PgPool,
    k8s_client: Client,
    http_client: reqwest::Client,
    node_name: String,
    interval_secs: u64,
    metrics_token: String,
    state: Arc<CollectorState>,
) {
    let mut ticker = time::interval(Duration::from_secs(interval_secs));
    ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        let start = Instant::now();
        let now = Utc::now();

        let pods = match k8s::list_node_project_pods(&k8s_client, &node_name).await {
            Ok(p) => p,
            Err(e) => {
                warn!("failed to list node project pods: {e}");
                continue;
            }
        };

        // cAdvisor for CPU/memory/network — one fetch per node per tick.
        let usage = match cadvisor::node_pod_usage(&k8s_client, &node_name).await {
            Ok(u) => u,
            Err(e) => {
                warn!("failed to fetch cadvisor metrics: {e}");
                Default::default()
            }
        };

        let mut samples: Vec<store::Sample> = Vec::new();
        let mut project_namespaces: BTreeSet<(String, String)> = BTreeSet::new();

        for pod in &pods {
            let Ok(project_uuid) = Uuid::parse_str(&pod.project_id) else {
                warn!("invalid project_id UUID: {}", pod.project_id);
                continue;
            };
            project_namespaces.insert((pod.project_id.clone(), pod.namespace.clone()));

            if let Some(u) = usage.get(&(pod.namespace.clone(), pod.pod_name.clone())) {
                push(
                    &mut samples,
                    project_uuid,
                    "cpu_seconds",
                    u.cpu_seconds,
                    now,
                );
                push(
                    &mut samples,
                    project_uuid,
                    "memory_byte_seconds",
                    u.memory_bytes,
                    now,
                );
                push(&mut samples, project_uuid, "ingress_bytes", u.rx_bytes, now);
                push(&mut samples, project_uuid, "egress_bytes", u.tx_bytes, now);
            }

            match scrape::last_activity_at(&http_client, &pod.pod_ip, &metrics_token).await {
                Ok(v) => push(&mut samples, project_uuid, "last_activity_at", v, now),
                Err(e) => {
                    tracing::debug!("last_activity scrape failed for {}: {e}", pod.project_id)
                }
            }
        }

        // PVC allocated capacity per project (billing on allocated size).
        for (project_id, namespace) in &project_namespaces {
            let Ok(project_uuid) = Uuid::parse_str(project_id) else {
                continue;
            };
            match k8s::pvc_capacity_bytes(&k8s_client, namespace).await {
                Ok(bytes) if bytes > 0 => {
                    push(&mut samples, project_uuid, "disk_bytes", bytes as f64, now)
                }
                Ok(_) => {}
                Err(e) => tracing::debug!("pvc capacity failed for {namespace}: {e}"),
            }
        }

        let pod_count = pods.len() as u64;
        if let Err(e) = store::batch_insert(&pool, samples).await {
            warn!("batch insert failed: {e}");
        }

        let elapsed_ms = start.elapsed().as_millis() as u64;
        state.last_scrape_ms.store(elapsed_ms, Ordering::Relaxed);
        state.last_pod_count.store(pod_count, Ordering::Relaxed);
        info!(pods = pod_count, elapsed_ms, node = %node_name, "scrape cycle complete");
    }
}

fn push(
    samples: &mut Vec<store::Sample>,
    project_id: Uuid,
    metric: &'static str,
    value: f64,
    now: chrono::DateTime<Utc>,
) {
    samples.push(store::Sample {
        project_id,
        metric,
        value,
        sampled_at: now,
    });
}

// ---------------------------------------------------------------------------
// /metrics handler (liveness/readiness)
// ---------------------------------------------------------------------------

async fn metrics_handler(State(state): State<Arc<CollectorState>>) -> Response<String> {
    let scrape_ms = state.last_scrape_ms.load(Ordering::Relaxed);
    let pod_count = state.last_pod_count.load(Ordering::Relaxed);
    let body = format!(
        "slipstream_collector_scrape_duration_ms {scrape_ms}\n\
         slipstream_collector_pods_scraped {pod_count}\n"
    );
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        .body(body)
        .expect("response build failed")
}
