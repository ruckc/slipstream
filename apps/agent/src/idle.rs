use crate::shell::SessionStore;
use parking_lot::Mutex;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::watch;
use tracing::{info, warn};

pub struct IdleTracker {
    last_activity: Arc<Mutex<Instant>>,
    sessions: Arc<SessionStore>,
    web_url: String,
    project_id: String,
}

impl IdleTracker {
    pub fn new(sessions: Arc<SessionStore>, web_url: String, project_id: String) -> Self {
        Self {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            sessions,
            web_url,
            project_id,
        }
    }

    /// Update the last activity timestamp to now.
    pub fn touch(&self) {
        *self.last_activity.lock() = Instant::now();
    }

    /// Start a background task that checks for idleness every 30 seconds.
    /// When idle, calls the SvelteKit shutdown endpoint which scales the Deployment
    /// to zero. The pod then waits for SIGTERM from Kubernetes.
    pub fn start(self, idle_timeout_secs: u64, _shutdown_tx: watch::Sender<bool>) {
        let last_activity = self.last_activity.clone();
        let sessions = self.sessions.clone();
        let timeout = Duration::from_secs(idle_timeout_secs);
        let web_url = self.web_url.clone();
        let project_id = self.project_id.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));

            loop {
                interval.tick().await;

                let active = sessions.active_connections();
                let elapsed = last_activity.lock().elapsed();

                if active == 0 && elapsed >= timeout {
                    info!(
                        "Idle timeout reached ({} secs with no connections), signaling shutdown",
                        idle_timeout_secs
                    );

                    let client = reqwest::Client::new();
                    let url = format!("{}/api/agent/shutdown", web_url);
                    let body = serde_json::json!({ "projectId": project_id });

                    for attempt in 1..=3u32 {
                        match client.post(&url).json(&body).send().await {
                            Ok(resp) if resp.status().is_success() => {
                                info!("Shutdown accepted, waiting for SIGTERM");
                                return;
                            }
                            Ok(resp) => {
                                warn!(
                                    "Shutdown rejected with status {}, not retrying",
                                    resp.status()
                                );
                                return;
                            }
                            Err(e) => {
                                warn!("Shutdown request failed (attempt {}): {}", attempt, e);
                                if attempt < 3 {
                                    tokio::time::sleep(Duration::from_secs(5)).await;
                                }
                            }
                        }
                    }

                    warn!("Failed to signal shutdown after 3 attempts");
                    return;
                }
            }
        });
    }
}
