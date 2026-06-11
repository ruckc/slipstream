use crate::shell::SessionStore;
use parking_lot::Mutex;
use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

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

    pub fn touch(&self) {
        *self.last_activity.lock() = Instant::now();
    }

    pub fn last_activity_at_unix(&self) -> f64 {
        let elapsed: Duration = self.last_activity.lock().elapsed();
        let unix_now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        unix_now - elapsed.as_secs_f64()
    }

    pub fn active_sessions(&self) -> usize {
        self.sessions.active_connections()
    }
}
