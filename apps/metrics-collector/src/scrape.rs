use anyhow::{Context, Result};

/// A single scraped metric value from a pod's /metrics endpoint.
pub struct ScrapedMetric {
    pub db_name: &'static str,
    pub value: f64,
}

/// Metric name mappings: Prometheus name → usage_samples.metric string.
/// Only metrics we care about are listed; others are ignored.
static METRIC_MAP: &[(&str, &str)] = &[
    ("slipstream_cpu_seconds_total", "cpu_seconds"),
    ("slipstream_memory_bytes", "memory_byte_seconds"),
    ("slipstream_disk_bytes", "disk_bytes"),
    ("slipstream_network_ingress_bytes_total", "ingress_bytes"),
    ("slipstream_network_egress_bytes_total", "egress_bytes"),
    ("slipstream_last_activity_at", "last_activity_at"),
    ("slipstream_active_sessions", "active_sessions"),
];

fn prometheus_name_to_db(name: &str) -> Option<&'static str> {
    METRIC_MAP
        .iter()
        .find(|(prom, _)| *prom == name)
        .map(|(_, db)| *db)
}

pub async fn scrape(
    client: &reqwest::Client,
    project_id: &str,
) -> Result<Vec<ScrapedMetric>> {
    let url = format!(
        "http://svc-{project_id}.project-{project_id}.svc.cluster.local:8080/metrics"
    );
    let body = client
        .get(&url)
        .send()
        .await
        .context("GET /metrics")?
        .error_for_status()
        .context("non-2xx from /metrics")?
        .text()
        .await
        .context("read /metrics body")?;

    Ok(parse_prometheus_text(&body))
}

fn parse_prometheus_text(text: &str) -> Vec<ScrapedMetric> {
    let mut results = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Format: metric_name{labels} value [timestamp]
        // or:     metric_name value [timestamp]
        let (name_part, rest) = if let Some(brace) = line.find('{') {
            let end = line.find('}').unwrap_or(brace);
            (&line[..brace], line[end + 1..].trim())
        } else {
            let mut parts = line.splitn(2, ' ');
            let name = parts.next().unwrap_or("");
            (name, parts.next().unwrap_or("").trim())
        };

        let db_name = match prometheus_name_to_db(name_part) {
            Some(n) => n,
            None => continue,
        };

        // rest is "value [timestamp]" — take first token
        let value_str = rest.split_whitespace().next().unwrap_or("");
        let Ok(value) = value_str.parse::<f64>() else {
            continue;
        };

        results.push(ScrapedMetric { db_name, value });
    }
    results
}
