use std::{
    env,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use axum::{http::StatusCode, routing::get, Router};
use base64::Engine as _;
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use sqlx::PgPool;
use tokio::{net::TcpListener, time};
use tracing::{info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Harbor API types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HarborRepository {
    name: String,
}

#[derive(Deserialize)]
struct HarborArtifact {
    size: Option<i64>,
}

// ---------------------------------------------------------------------------
// Harbor API client
// ---------------------------------------------------------------------------

struct HarborClient {
    client: Client,
    base_url: String,
    auth_header: String,
}

impl HarborClient {
    fn new(base_url: String, username: &str, password: &str) -> Self {
        let credentials = format!("{}:{}", username, password);
        let auth_header = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(credentials)
        );
        HarborClient {
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("build reqwest client"),
            base_url,
            auth_header,
        }
    }

    async fn list_repositories(&self, namespace_slug: &str) -> Result<Vec<HarborRepository>> {
        let url = format!(
            "{}/api/v2.0/projects/{}/repositories?page_size=100",
            self.base_url, namespace_slug,
        );
        let res = self
            .client
            .get(&url)
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .context("list repositories")?;

        if res.status().as_u16() == 404 {
            return Ok(vec![]);
        }
        if !res.status().is_success() {
            warn!(url, status = %res.status(), "list_repositories failed");
            return Ok(vec![]);
        }
        Ok(res.json::<Vec<HarborRepository>>().await?)
    }

    async fn sum_artifact_sizes(&self, namespace_slug: &str, full_repo_name: &str) -> Result<i64> {
        // Harbor full repo name is "<namespace_slug>/<project_slug>/<repo>".
        // The URL path segment after the project needs double-percent-encoding for slashes.
        let repo_relative = full_repo_name
            .strip_prefix(&format!("{}/", namespace_slug))
            .unwrap_or(full_repo_name);
        let encoded_repo = repo_relative.replace('/', "%2F");
        let url = format!(
            "{}/api/v2.0/projects/{}/repositories/{}/artifacts?page_size=100&with_tag=false",
            self.base_url, namespace_slug, encoded_repo,
        );
        let res = self
            .client
            .get(&url)
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .context("list artifacts")?;

        if res.status().as_u16() == 404 {
            return Ok(0);
        }
        if !res.status().is_success() {
            return Ok(0);
        }
        let artifacts: Vec<HarborArtifact> = res.json().await?;
        Ok(artifacts.iter().map(|a| a.size.unwrap_or(0)).sum())
    }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

struct NamespaceRow {
    namespace_id: Uuid,
    namespace_slug: String,
}

struct ProjectRow {
    project_id: Uuid,
    project_slug: String,
}

async fn list_namespaces(pool: &PgPool) -> Result<Vec<NamespaceRow>> {
    let rows = sqlx::query(
        r#"SELECT nr.namespace_id, n.slug AS namespace_slug
           FROM namespace_registry nr
           JOIN namespaces n ON n.id = nr.namespace_id"#,
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row as _;
    Ok(rows
        .into_iter()
        .map(|r| NamespaceRow {
            namespace_id: r.get("namespace_id"),
            namespace_slug: r.get("namespace_slug"),
        })
        .collect())
}

async fn list_projects(pool: &PgPool, namespace_id: Uuid) -> Result<Vec<ProjectRow>> {
    let rows = sqlx::query("SELECT id, slug FROM projects WHERE namespace_id = $1")
        .bind(namespace_id)
        .fetch_all(pool)
        .await?;

    use sqlx::Row as _;
    Ok(rows
        .into_iter()
        .map(|r| ProjectRow {
            project_id: r.get("id"),
            project_slug: r.get("slug"),
        })
        .collect())
}

async fn insert_usage_sample(pool: &PgPool, project_id: Uuid, storage_bytes: i64) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO usage_samples (project_id, metric, value, sampled_at)
           VALUES ($1, 'registry_storage_bytes', $2, $3)"#,
    )
    .bind(project_id)
    .bind(storage_bytes as f64)
    .bind(Utc::now())
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Collection loop
// ---------------------------------------------------------------------------

async fn collect_once(harbor: &HarborClient, pool: &PgPool) -> Result<usize> {
    let namespaces = list_namespaces(pool).await?;
    let mut projects_sampled: usize = 0;

    for ns in &namespaces {
        let projects = match list_projects(pool, ns.namespace_id).await {
            Ok(p) => p,
            Err(e) => {
                warn!(namespace = %ns.namespace_slug, "list projects failed: {e}");
                continue;
            }
        };

        let all_repos = match harbor.list_repositories(&ns.namespace_slug).await {
            Ok(r) => r,
            Err(e) => {
                warn!(namespace = %ns.namespace_slug, "list repositories failed: {e}");
                continue;
            }
        };

        for proj in &projects {
            let prefix = format!("{}/{}/", ns.namespace_slug, proj.project_slug);
            let project_repos: Vec<_> = all_repos
                .iter()
                .filter(|r| r.name.starts_with(&prefix))
                .collect();

            if project_repos.is_empty() {
                continue;
            }

            let mut total_bytes: i64 = 0;
            for repo in &project_repos {
                match harbor
                    .sum_artifact_sizes(&ns.namespace_slug, &repo.name)
                    .await
                {
                    Ok(bytes) => total_bytes += bytes,
                    Err(e) => warn!(repo = %repo.name, "artifact size failed: {e}"),
                }
            }

            if total_bytes > 0 {
                if let Err(e) = insert_usage_sample(pool, proj.project_id, total_bytes).await {
                    warn!(project = %proj.project_slug, "insert usage sample failed: {e}");
                } else {
                    projects_sampled += 1;
                }
            }
        }
    }

    Ok(projects_sampled)
}

async fn sample_loop(harbor: HarborClient, pool: PgPool, interval_secs: u64) {
    let mut ticker = time::interval(Duration::from_secs(interval_secs));
    ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        let start = Instant::now();
        match collect_once(&harbor, &pool).await {
            Ok(count) => info!(
                projects = count,
                elapsed_ms = start.elapsed().as_millis(),
                "registry sample cycle complete"
            ),
            Err(e) => warn!("registry sample cycle failed: {e}"),
        }
    }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

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
    let harbor_url =
        env::var("HARBOR_URL").context("HARBOR_URL environment variable is required")?;
    let harbor_user = env::var("HARBOR_ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_string());
    let harbor_pass = env::var("HARBOR_ADMIN_PASSWORD")
        .context("HARBOR_ADMIN_PASSWORD environment variable is required")?;

    let interval_secs: u64 = env::var("SCRAPE_INTERVAL_SECONDS")
        .unwrap_or_else(|_| "300".to_string())
        .parse()
        .context("Invalid SCRAPE_INTERVAL_SECONDS")?;

    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .context("Invalid PORT")?;

    info!(harbor_url, interval_secs, "harbor-collector starting");

    let pool = PgPool::connect(&database_url)
        .await
        .context("connect to Postgres")?;

    let harbor = HarborClient::new(
        harbor_url.trim_end_matches('/').to_string(),
        &harbor_user,
        &harbor_pass,
    );

    tokio::spawn(sample_loop(harbor, pool, interval_secs));

    let app = Router::new().route("/health", get(|| async { StatusCode::OK }));
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
    let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
    let mut sigint = signal(SignalKind::interrupt()).expect("SIGINT handler");
    tokio::select! {
        _ = sigterm.recv() => { info!("received SIGTERM"); }
        _ = sigint.recv() => { info!("received SIGINT"); }
    }
}
