use std::collections::HashMap;

use anyhow::{Context, Result};
use http::Request;
use kube::Client;

/// Aggregated resource usage for a single pod, summed across its containers.
#[derive(Default, Clone, Copy)]
pub struct PodUsage {
    /// Cumulative CPU seconds (counter).
    pub cpu_seconds: f64,
    /// Current working-set memory in bytes (gauge).
    pub memory_bytes: f64,
    /// Cumulative bytes received (counter).
    pub rx_bytes: f64,
    /// Cumulative bytes transmitted (counter).
    pub tx_bytes: f64,
}

/// Fetches the node's cAdvisor metrics through the API server proxy. Going via
/// the API server (rather than hitting the kubelet directly) reuses the kube
/// client's TLS/auth and only needs `nodes/proxy` RBAC — no direct kubelet
/// certificate handling.
pub async fn node_pod_usage(
    client: &Client,
    node_name: &str,
) -> Result<HashMap<(String, String), PodUsage>> {
    let path = format!("/api/v1/nodes/{node_name}/proxy/metrics/cadvisor");
    let req = Request::get(&path)
        .body(Vec::new())
        .context("build cadvisor request")?;
    let text = client
        .request_text(req)
        .await
        .context("GET cadvisor metrics")?;
    Ok(parse_cadvisor(&text))
}

/// Parses cAdvisor Prometheus text into per-pod usage keyed by (namespace, pod).
fn parse_cadvisor(text: &str) -> HashMap<(String, String), PodUsage> {
    let mut out: HashMap<(String, String), PodUsage> = HashMap::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(brace) = line.find('{') else {
            continue;
        };
        let name = &line[..brace];

        let metric = match name {
            "container_cpu_usage_seconds_total"
            | "container_memory_working_set_bytes"
            | "container_network_receive_bytes_total"
            | "container_network_transmit_bytes_total" => name,
            _ => continue,
        };

        let Some(end) = line.find('}') else {
            continue;
        };
        let labels = &line[brace + 1..end];
        let value_str = line[end + 1..].split_whitespace().next().unwrap_or("");
        let Ok(value) = value_str.parse::<f64>() else {
            continue;
        };

        let namespace = label_value(labels, "namespace").unwrap_or_default();
        let pod = label_value(labels, "pod").unwrap_or_default();
        if namespace.is_empty() || pod.is_empty() {
            continue;
        }
        let container = label_value(labels, "container").unwrap_or_default();

        // A "real" container (not the pod sandbox "POD", not the empty
        // pod-cgroup rollup) for CPU/memory summing.
        let real_container = !container.is_empty() && container != "POD";
        // Network counters are reported once per pod at the pod-cgroup level
        // (empty container label), labelled per interface; skip loopback.
        let pod_iface =
            container.is_empty() && label_value(labels, "interface").as_deref() != Some("lo");

        let entry = out.entry((namespace, pod)).or_default();
        match metric {
            "container_cpu_usage_seconds_total" if real_container => entry.cpu_seconds += value,
            "container_memory_working_set_bytes" if real_container => entry.memory_bytes += value,
            "container_network_receive_bytes_total" if pod_iface => entry.rx_bytes += value,
            "container_network_transmit_bytes_total" if pod_iface => entry.tx_bytes += value,
            _ => {}
        }
    }

    out
}

/// Extracts a single label value from a Prometheus label segment
/// (`key="value",key2="value2"`).
fn label_value(labels: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let start = labels.find(&needle)? + needle.len();
    let rest = &labels[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_cadvisor;

    #[test]
    fn sums_containers_and_skips_pod_and_lo() {
        let text = r#"
container_cpu_usage_seconds_total{container="agent",namespace="project-x",pod="p1"} 10
container_cpu_usage_seconds_total{container="buildkit",namespace="project-x",pod="p1"} 5
container_cpu_usage_seconds_total{container="POD",namespace="project-x",pod="p1"} 99
container_memory_working_set_bytes{container="agent",namespace="project-x",pod="p1"} 1000
container_network_receive_bytes_total{container="",interface="eth0",namespace="project-x",pod="p1"} 2000
container_network_receive_bytes_total{container="",interface="lo",namespace="project-x",pod="p1"} 7
container_network_transmit_bytes_total{container="",interface="eth0",namespace="project-x",pod="p1"} 3000
"#;
        let m = parse_cadvisor(text);
        let u = m.get(&("project-x".to_string(), "p1".to_string())).unwrap();
        assert_eq!(u.cpu_seconds, 15.0);
        assert_eq!(u.memory_bytes, 1000.0);
        assert_eq!(u.rx_bytes, 2000.0);
        assert_eq!(u.tx_bytes, 3000.0);
    }
}
