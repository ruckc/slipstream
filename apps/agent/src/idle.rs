use crate::shell::SessionStore;
use parking_lot::Mutex;
use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tracing::{info, warn};

pub struct IdleTracker {
    last_activity: Arc<Mutex<Instant>>,
    sessions: Arc<SessionStore>,
    metrics_push_url: Option<String>,
    project_id: String,
}

impl IdleTracker {
    pub fn new(
        sessions: Arc<SessionStore>,
        metrics_push_url: Option<String>,
        project_id: String,
    ) -> Self {
        Self {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            sessions,
            metrics_push_url,
            project_id,
        }
    }

    /// Update the last activity timestamp to now.
    pub fn touch(&self) {
        *self.last_activity.lock() = Instant::now();
    }

    /// Start a background task that pushes `slipstream_last_activity_at` to
    /// VictoriaMetrics every 30 seconds. The web server's reconciler queries
    /// this metric to detect idle projects and scale their deployments to zero.
    pub fn start(self, _idle_timeout_secs: u64) {
        let Some(push_url) = self.metrics_push_url.clone() else {
            info!("METRICS_PUSH_URL not set; idle metric reporting disabled");
            return;
        };

        let last_activity = self.last_activity.clone();
        let sessions = self.sessions.clone();
        let project_id = self.project_id.clone();
        let push_url = push_url.trim_end_matches('/').to_owned();

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let url = format!("{}/api/v1/import/prometheus", push_url);
            let mut interval = tokio::time::interval(Duration::from_secs(30));

            loop {
                interval.tick().await;

                // last_activity is an Instant; convert to a Unix timestamp by
                // computing how far it is behind "now" and subtracting from the
                // current wall-clock time.
                let elapsed = last_activity.lock().elapsed();
                let active_sessions = sessions.active_connections();
                let unix_now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64();
                let last_activity_at = unix_now - elapsed.as_secs_f64();

                let ts_ms = (unix_now * 1000.0) as u64;
                let label = format!(r#"{{project_id="{}"}}"#, project_id);
                let payload = format!(
                    "slipstream_last_activity_at{label} {last_activity_at:.3} {ts_ms}\n\
                     slipstream_active_sessions{label} {active_sessions} {ts_ms}\n"
                );

                match client
                    .post(&url)
                    .header("Content-Type", "text/plain")
                    .body(payload)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {}
                    Ok(resp) => warn!("metrics push rejected: {}", resp.status()),
                    Err(e) => warn!("metrics push failed: {}", e),
                }
            }
        });
    }
}
