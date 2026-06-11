use std::{
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
use tokio::{net::TcpListener, signal, time};
use tracing::{info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use uuid::Uuid;

mod k8s;
mod scrape;
mod store;

// ---------------------------------------------------------------------------
// Shared collector state (for /metrics self-reporting)
// ---------------------------------------------------------------------------

struct CollectorState {
    /// Duration of the last scrape cycle in milliseconds.
    last_scrape_ms: AtomicU64,
    /// Number of projects scraped in the last cycle.
    last_project_count: AtomicU64,
    scrape_interval_ms: u64,
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer().json())
        .init();

    let database_url =
        env::var("DATABASE_URL").context("DATABASE_URL environment variable is required")?;

    let scrape_interval_secs: u64 = env::var("SCRAPE_INTERVAL_SECONDS")
        .unwrap_or_else(|_| "30".to_string())
        .parse()
        .context("Invalid SCRAPE_INTERVAL_SECONDS")?;

    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .context("Invalid PORT")?;

    // Derive StatefulSet identity from pod hostname: <name>-<ordinal>
    let (sts_name, my_ordinal) = parse_ordinal_from_hostname();
    let my_namespace = read_namespace();

    info!(
        sts_name,
        my_ordinal, my_namespace, scrape_interval_secs, "metrics-collector starting"
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
        last_project_count: AtomicU64::new(0),
        scrape_interval_ms: scrape_interval_secs * 1000,
    });

    // Spawn the scrape loop.
    let loop_state = state.clone();
    tokio::spawn(scrape_loop(
        pool,
        k8s_client,
        http_client,
        my_namespace.clone(),
        sts_name.clone(),
        my_ordinal,
        scrape_interval_secs,
        loop_state,
    ));

    // Serve /metrics for HPA.
    let app = Router::new()
        .route("/metrics", get(metrics_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).await?;
    info!("Listening on {addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Scrape loop
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn scrape_loop(
    pool: PgPool,
    k8s_client: Client,
    http_client: reqwest::Client,
    namespace: String,
    sts_name: String,
    my_ordinal: u32,
    interval_secs: u64,
    state: Arc<CollectorState>,
) {
    let mut ticker = time::interval(Duration::from_secs(interval_secs));
    ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        let start = Instant::now();

        let replica_count = k8s::get_replica_count(&k8s_client, &namespace, &sts_name).await;

        let all_projects = match k8s::list_running_projects(&k8s_client).await {
            Ok(p) => p,
            Err(e) => {
                warn!("failed to list running projects: {e}");
                continue;
            }
        };

        // Shard: only scrape projects whose hash maps to this ordinal.
        let my_projects: Vec<_> = all_projects
            .into_iter()
            .filter(|p| fnv1a_hash(&p.project_id) % replica_count == my_ordinal)
            .collect();

        let project_count = my_projects.len() as u64;
        let now = Utc::now();

        // Scrape all assigned pods concurrently.
        let scrape_results = {
            let futs: Vec<_> = my_projects
                .iter()
                .map(|p| {
                    let client = http_client.clone();
                    let project_id = p.project_id.clone();
                    async move {
                        let result = scrape::scrape(&client, &project_id).await;
                        (project_id, result)
                    }
                })
                .collect();
            futures_util::future::join_all(futs).await
        };

        // Build batch.
        let mut samples = Vec::new();
        for (project_id_str, result) in scrape_results {
            let project_uuid = match Uuid::parse_str(&project_id_str) {
                Ok(u) => u,
                Err(_) => {
                    warn!("invalid project_id UUID: {project_id_str}");
                    continue;
                }
            };
            match result {
                Ok(metrics) => {
                    for m in metrics {
                        samples.push(store::Sample {
                            project_id: project_uuid,
                            metric: m.db_name,
                            value: m.value,
                            sampled_at: now,
                        });
                    }
                }
                Err(e) => {
                    tracing::debug!("scrape failed for {project_id_str}: {e}");
                }
            }
        }

        if let Err(e) = store::batch_insert(&pool, samples).await {
            warn!("batch insert failed: {e}");
        }

        let elapsed_ms = start.elapsed().as_millis() as u64;
        state.last_scrape_ms.store(elapsed_ms, Ordering::Relaxed);
        state
            .last_project_count
            .store(project_count, Ordering::Relaxed);

        info!(
            projects = project_count,
            elapsed_ms,
            replica = my_ordinal,
            total_replicas = replica_count,
            "scrape cycle complete"
        );
    }
}

// ---------------------------------------------------------------------------
// /metrics handler
// ---------------------------------------------------------------------------

async fn metrics_handler(State(state): State<Arc<CollectorState>>) -> Response<String> {
    let scrape_ms = state.last_scrape_ms.load(Ordering::Relaxed);
    let project_count = state.last_project_count.load(Ordering::Relaxed);
    let interval_ms = state.scrape_interval_ms;

    let saturation = if interval_ms > 0 {
        scrape_ms as f64 / interval_ms as f64
    } else {
        0.0
    };

    let body = format!(
        "slipstream_collector_scrape_duration_ms {scrape_ms}\n\
         slipstream_collector_projects_scraped {project_count}\n\
         slipstream_collector_saturation_ratio {saturation:.4}\n"
    );

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        .body(body)
        .expect("response build failed")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// FNV-1a 32-bit hash — stable across processes and versions.
fn fnv1a_hash(s: &str) -> u32 {
    const OFFSET: u32 = 2166136261;
    const PRIME: u32 = 16777619;
    s.bytes()
        .fold(OFFSET, |h, b| (h ^ b as u32).wrapping_mul(PRIME))
}

/// Parse `<name>-<ordinal>` from the pod hostname. Falls back to ordinal 0.
fn parse_ordinal_from_hostname() -> (String, u32) {
    let hostname = env::var("HOSTNAME").unwrap_or_default();
    let sts_name =
        env::var("STATEFULSET_NAME").unwrap_or_else(|_| "slipstream-metrics-collector".to_string());

    if let Some(ordinal_str) = hostname.rsplit('-').next() {
        if let Ok(ordinal) = ordinal_str.parse::<u32>() {
            // Strip the trailing -<ordinal> to get the StatefulSet name.
            let derived_name = hostname[..hostname.len() - ordinal_str.len() - 1].to_string();
            let name = if derived_name.is_empty() {
                sts_name
            } else {
                derived_name
            };
            return (name, ordinal);
        }
    }
    (sts_name, 0)
}

fn read_namespace() -> String {
    std::fs::read_to_string("/var/run/secrets/kubernetes.io/serviceaccount/namespace")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "slipstream-system".to_string())
}
