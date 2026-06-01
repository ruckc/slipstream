use crate::shell::SessionStore;
use parking_lot::Mutex;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::watch;
use tracing::info;

pub struct IdleTracker {
    last_activity: Arc<Mutex<Instant>>,
    sessions: Arc<SessionStore>,
}

impl IdleTracker {
    pub fn new(sessions: Arc<SessionStore>) -> Self {
        Self {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            sessions,
        }
    }

    /// Update the last activity timestamp to now.
    pub fn touch(&self) {
        *self.last_activity.lock() = Instant::now();
    }

    /// Start a background task that checks for idleness every 30 seconds.
    /// If there are no active WebSocket connections AND the last activity
    /// timestamp is older than `idle_timeout_secs`, the process exits.
    pub fn start(self, idle_timeout_secs: u64, _shutdown_tx: watch::Sender<bool>) {
        let last_activity = self.last_activity.clone();
        let sessions = self.sessions.clone();
        let timeout = Duration::from_secs(idle_timeout_secs);

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));

            loop {
                interval.tick().await;

                let active = sessions.active_connections();
                let elapsed = last_activity.lock().elapsed();

                if active == 0 && elapsed >= timeout {
                    info!(
                        "Idle timeout reached ({} secs with no connections), shutting down",
                        idle_timeout_secs
                    );
                    std::process::exit(0);
                }
            }
        });
    }
}
