use std::sync::Arc;

use axum::{
    http::Method,
    response::Json,
    routing::{delete, get, post},
    Extension, Router,
};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::signal;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod auth;
mod config;
mod error;
mod fs;
mod idle;
mod shell;

use auth::{JwksCache, JwksCacheExt};
use config::Config;
use idle::IdleTracker;
use shell::SessionStore;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

pub struct AppState {
    pub config: Config,
    pub jwks: Arc<JwksCache>,
    pub sessions: Arc<SessionStore>,
    pub idle: Arc<IdleTracker>,
}

// ---------------------------------------------------------------------------
// Health handler (no auth)
// ---------------------------------------------------------------------------

async fn health() -> Json<serde_json::Value> {
    Json(json!({"status": "ok"}))
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize structured tracing.
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer().json())
        .init();

    info!("Slipstream agent starting");

    // 1. Config from environment.
    let config = Config::from_env()?;
    info!(
        port = config.port,
        project_id = %config.project_id,
        workspace_path = %config.workspace_path.display(),
        idle_timeout_secs = config.idle_timeout_secs,
        "Config loaded"
    );

    // 2. JWKS cache — fetches immediately, fails fast if unreachable.
    let jwks = Arc::new(JwksCache::new(config.jwks_url.clone(), config.project_id.clone()).await?);

    // 3. Session store + idle tracker.
    let sessions = Arc::new(SessionStore::new());
    let idle = Arc::new(IdleTracker::new(sessions.clone()));

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);

    // Start idle background task with a fresh IdleTracker that shares the same
    // sessions store.  The Arc<IdleTracker> in AppState is used for touch().
    let idle_bg = IdleTracker::new(sessions.clone());
    let idle_timeout = config.idle_timeout_secs;
    idle_bg.start(idle_timeout, shutdown_tx.clone());

    // 4. Build app state.
    let state = Arc::new(AppState {
        config,
        jwks: jwks.clone(),
        sessions,
        idle,
    });

    // 5. CORS layer.
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers(Any)
        .allow_origin(Any);

    // 6. Router.
    //
    // JwksCache is injected as an axum Extension so the AuthUser extractor
    // can pull it from request extensions without needing FromRef on Arc<AppState>.
    let app = Router::new()
        // Health (no auth)
        .route("/health", get(health))
        // Session management (requires 'shell' permission)
        .route("/sessions", post(shell::create_session))
        .route("/sessions", get(shell::list_sessions))
        .route("/sessions/:id", delete(shell::kill_session))
        .route("/sessions/:id/attach", get(shell::ws_attach))
        // Filesystem (requires 'files:read' or 'files:write')
        .route("/fs", get(fs::list_dir))
        .route("/fs/download", get(fs::download_file))
        .route("/fs/upload", post(fs::upload_file))
        .route("/fs", delete(fs::delete_path))
        .route("/fs/mkdir", post(fs::create_dir))
        // Attach state and layers
        .with_state(state.clone())
        .layer(Extension(JwksCacheExt(jwks)))
        .layer(cors);

    // 7. Bind and serve with graceful shutdown.
    let addr = format!("0.0.0.0:{}", state.config.port);
    let listener = TcpListener::bind(&addr).await?;
    info!("Listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = signal::ctrl_c() => {
                    info!("Received SIGINT, shutting down");
                }
                _ = async {
                    #[cfg(unix)]
                    {
                        let mut sig = signal::unix::signal(signal::unix::SignalKind::terminate())
                            .expect("Failed to install SIGTERM handler");
                        sig.recv().await;
                        info!("Received SIGTERM, shutting down");
                    }
                    #[cfg(not(unix))]
                    {
                        std::future::pending::<()>().await
                    }
                } => {}
                _ = shutdown_rx.changed() => {
                    info!("Shutdown signal received");
                }
            }
        })
        .await?;

    info!("Agent shut down cleanly");
    Ok(())
}
