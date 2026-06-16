use anyhow::{Context, Result};

/// Scrapes `slipstream_last_activity_at` from an agent pod's `/metrics`
/// endpoint by pod IP. The DaemonSet only scrapes pods on its own node, so
/// the pod IP is always directly reachable — no service DNS needed.
///
/// This is now the only metric the agent exposes; CPU/memory/network/disk
/// come from cAdvisor and the Kubernetes API instead.
pub async fn last_activity_at(
    client: &reqwest::Client,
    pod_ip: &str,
    metrics_token: &str,
) -> Result<f64> {
    let url = format!("http://{pod_ip}:8080/metrics");
    let body = client
        .get(&url)
        .header("Authorization", format!("Bearer {metrics_token}"))
        .send()
        .await
        .context("GET /metrics")?
        .error_for_status()
        .context("non-2xx from /metrics")?
        .text()
        .await
        .context("read /metrics body")?;

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let name = line.split(['{', ' ']).next().unwrap_or("");
        if name != "slipstream_last_activity_at" {
            continue;
        }
        // Format: slipstream_last_activity_at{labels} value
        let value_str = match line.find('}') {
            Some(end) => line[end + 1..].split_whitespace().next().unwrap_or(""),
            None => line.split_whitespace().nth(1).unwrap_or(""),
        };
        if let Ok(v) = value_str.parse::<f64>() {
            return Ok(v);
        }
    }
    anyhow::bail!("slipstream_last_activity_at not found")
}
