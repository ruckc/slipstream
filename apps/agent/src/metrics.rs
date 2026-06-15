use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{extract::State, http::StatusCode, response::Response};
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::warn;

use crate::AppState;

/// How long a computed disk-usage value is served before recomputing.
const DISK_USAGE_TTL: Duration = Duration::from_secs(120);
/// A `du` walk slower than this is logged so silent CPU spikes become visible.
const SLOW_DU_THRESHOLD: Duration = Duration::from_secs(5);

/// Caches `du` results per path so a full-tree walk runs at most once per TTL,
/// regardless of how many scrapers hit `/metrics` or how often. The lock is
/// held across the (slow) walk so concurrent scrapes coalesce into one walk
/// instead of stacking up and pegging the CPU.
#[derive(Default)]
pub struct DiskUsageCache {
    inner: Mutex<HashMap<PathBuf, (Instant, u64)>>,
}

impl DiskUsageCache {
    pub fn new() -> Self {
        Self::default()
    }

    async fn bytes(&self, path: &Path) -> anyhow::Result<u64> {
        let mut guard = self.inner.lock().await;
        if let Some((at, val)) = guard.get(path) {
            if at.elapsed() < DISK_USAGE_TTL {
                return Ok(*val);
            }
        }
        match read_disk_bytes(path).await {
            Ok(bytes) => {
                guard.insert(path.to_path_buf(), (Instant::now(), bytes));
                Ok(bytes)
            }
            // Serve the last known value (if any) rather than failing the scrape.
            Err(e) => match guard.get(path) {
                Some((_, val)) => Ok(*val),
                None => Err(e),
            },
        }
    }
}

pub async fn metrics_handler(
    State(state): State<Arc<AppState>>,
    req: axum::extract::Request,
) -> Response<String> {
    // Require a bearer token if METRICS_TOKEN is configured; deny all access if unset.
    match state.config.metrics_token.as_deref() {
        None => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body("metrics access requires METRICS_TOKEN to be configured".to_string())
                .expect("response build failed");
        }
        Some(expected) => {
            let provided = req
                .headers()
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "));
            match provided {
                Some(token) if token == expected => {}
                _ => {
                    return Response::builder()
                        .status(StatusCode::UNAUTHORIZED)
                        .body("invalid or missing metrics token".to_string())
                        .expect("response build failed");
                }
            }
        }
    }

    let project_id = &state.config.project_id;
    let label = format!(r#"{{project_id="{project_id}"}}"#);
    let mut out = String::with_capacity(512);

    match read_cpu_usec() {
        Ok(usec) => {
            let secs = usec as f64 / 1e6;
            out.push_str(&format!("slipstream_cpu_seconds_total{label} {secs}\n"));
        }
        Err(e) => warn!("metrics: cpu read error: {e}"),
    }

    match read_memory_bytes() {
        Ok(bytes) => out.push_str(&format!("slipstream_memory_bytes{label} {bytes}\n")),
        Err(e) => warn!("metrics: memory read error: {e}"),
    }

    match state.disk_cache.bytes(&state.config.workspace_path).await {
        Ok(bytes) => out.push_str(&format!("slipstream_disk_bytes{label} {bytes}\n")),
        Err(e) => warn!("metrics: disk read error: {e}"),
    }

    match state.disk_cache.bytes(&state.config.home_path).await {
        Ok(bytes) => out.push_str(&format!("slipstream_home_disk_bytes{label} {bytes}\n")),
        Err(e) => warn!("metrics: home disk read error: {e}"),
    }

    match read_network_bytes("eth0") {
        Ok((rx, tx)) => {
            out.push_str(&format!(
                "slipstream_network_ingress_bytes_total{label} {rx}\n"
            ));
            out.push_str(&format!(
                "slipstream_network_egress_bytes_total{label} {tx}\n"
            ));
        }
        Err(e) => warn!("metrics: network read error: {e}"),
    }

    let last_activity_at = state.idle.last_activity_at_unix();
    out.push_str(&format!(
        "slipstream_last_activity_at{label} {last_activity_at:.3}\n"
    ));

    let active = state.idle.active_sessions();
    out.push_str(&format!("slipstream_active_sessions{label} {active}\n"));

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        .body(out)
        .expect("response build failed")
}

fn read_cpu_usec() -> anyhow::Result<u64> {
    let data = std::fs::read_to_string("/sys/fs/cgroup/cpu.stat")?;
    for line in data.lines() {
        if let Some(rest) = line.strip_prefix("usage_usec ") {
            return Ok(rest.trim().parse()?);
        }
    }
    anyhow::bail!("usage_usec not found in /sys/fs/cgroup/cpu.stat")
}

fn read_memory_bytes() -> anyhow::Result<u64> {
    let data = std::fs::read_to_string("/sys/fs/cgroup/memory.current")?;
    Ok(data.trim().parse()?)
}

async fn read_disk_bytes(workspace_path: &Path) -> anyhow::Result<u64> {
    let started = Instant::now();
    let output = Command::new("du")
        .args(["-sb", workspace_path.to_str().unwrap_or("/workspace")])
        .output()
        .await?;
    let elapsed = started.elapsed();
    if elapsed >= SLOW_DU_THRESHOLD {
        // Surfaces the otherwise-silent CPU cost of walking a large tree.
        warn!(
            path = %workspace_path.display(),
            elapsed_ms = elapsed.as_millis() as u64,
            "metrics: slow disk-usage walk"
        );
    }
    if !output.status.success() {
        anyhow::bail!("du exited with {}", output.status);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let bytes_str = stdout.split_whitespace().next().unwrap_or("0");
    Ok(bytes_str.parse()?)
}

fn read_network_bytes(iface: &str) -> anyhow::Result<(u64, u64)> {
    let data = std::fs::read_to_string("/proc/net/dev")?;
    for line in data.lines() {
        let Some(colon) = line.find(':') else {
            continue;
        };
        if line[..colon].trim() != iface {
            continue;
        }
        let fields: Vec<&str> = line[colon + 1..].split_whitespace().collect();
        if fields.len() < 9 {
            anyhow::bail!("unexpected /proc/net/dev format for {iface}");
        }
        let rx: u64 = fields[0].parse()?;
        let tx: u64 = fields[8].parse()?;
        return Ok((rx, tx));
    }
    anyhow::bail!("interface {iface:?} not found in /proc/net/dev")
}
