use std::env;
use std::path::PathBuf;

pub struct Config {
    pub port: u16,
    pub jwks_url: String,
    pub project_id: String,
    pub workspace_path: PathBuf,
    pub home_path: PathBuf,
    pub idle_timeout_secs: u64,
    pub cors_origin: Option<String>,
    /// If set, the /metrics endpoint requires `Authorization: Bearer <token>`.
    /// If unset, /metrics returns 403 Forbidden.
    pub metrics_token: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse::<u16>()
            .map_err(|e| anyhow::anyhow!("Invalid PORT: {}", e))?;

        let jwks_url = env::var("JWKS_URL")
            .map_err(|_| anyhow::anyhow!("JWKS_URL environment variable is required"))?;
        {
            let parsed = reqwest::Url::parse(&jwks_url)
                .map_err(|_| anyhow::anyhow!("JWKS_URL is not a valid URL: {}", jwks_url))?;
            if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
                return Err(anyhow::anyhow!(
                    "JWKS_URL must use http or https with a non-empty host"
                ));
            }
        }

        let project_id = env::var("PROJECT_ID")
            .map_err(|_| anyhow::anyhow!("PROJECT_ID environment variable is required"))?;

        let workspace_path = env::var("WORKSPACE_PATH")
            .unwrap_or_else(|_| "/workspace".to_string())
            .into();

        let home_path = env::var("HOME_PATH")
            .unwrap_or_else(|_| "/home/agent".to_string())
            .into();

        let idle_timeout_secs = env::var("IDLE_TIMEOUT_SECONDS")
            .unwrap_or_else(|_| "1800".to_string())
            .parse::<u64>()
            .map_err(|e| anyhow::anyhow!("Invalid IDLE_TIMEOUT_SECONDS: {}", e))?;

        let cors_origin = env::var("CORS_ORIGIN").ok().filter(|s| !s.is_empty());
        let metrics_token = env::var("METRICS_TOKEN").ok().filter(|s| !s.is_empty());

        Ok(Self {
            port,
            jwks_url,
            project_id,
            workspace_path,
            home_path,
            idle_timeout_secs,
            cors_origin,
            metrics_token,
        })
    }
}
