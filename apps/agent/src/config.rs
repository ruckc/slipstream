use std::env;
use std::path::PathBuf;

pub struct Config {
    pub port: u16,
    pub jwks_url: String,
    pub project_id: String,
    pub workspace_path: PathBuf,
    pub idle_timeout_secs: u64,
    pub metrics_push_url: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse::<u16>()
            .map_err(|e| anyhow::anyhow!("Invalid PORT: {}", e))?;

        let jwks_url = env::var("JWKS_URL")
            .map_err(|_| anyhow::anyhow!("JWKS_URL environment variable is required"))?;

        let project_id = env::var("PROJECT_ID")
            .map_err(|_| anyhow::anyhow!("PROJECT_ID environment variable is required"))?;

        let workspace_path = env::var("WORKSPACE_PATH")
            .unwrap_or_else(|_| "/workspace".to_string())
            .into();

        let idle_timeout_secs = env::var("IDLE_TIMEOUT_SECONDS")
            .unwrap_or_else(|_| "1800".to_string())
            .parse::<u64>()
            .map_err(|e| anyhow::anyhow!("Invalid IDLE_TIMEOUT_SECONDS: {}", e))?;

        let metrics_push_url = env::var("METRICS_PUSH_URL").ok();

        Ok(Self {
            port,
            jwks_url,
            project_id,
            workspace_path,
            idle_timeout_secs,
            metrics_push_url,
        })
    }
}
