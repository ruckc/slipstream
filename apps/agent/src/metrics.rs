use std::path::Path;
use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::Response};
use tokio::process::Command;
use tracing::warn;

use crate::AppState;

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

    match read_disk_bytes(&state.config.workspace_path).await {
        Ok(bytes) => out.push_str(&format!("slipstream_disk_bytes{label} {bytes}\n")),
        Err(e) => warn!("metrics: disk read error: {e}"),
    }

    match read_disk_bytes(&state.config.home_path).await {
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
    let output = Command::new("du")
        .args(["-sb", workspace_path.to_str().unwrap_or("/workspace")])
        .output()
        .await?;
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
