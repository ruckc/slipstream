use std::collections::HashMap;

use anyhow::{Context, Result};
use serde::Deserialize;
use tokio::process::Command;

/// Cilium reserved security identities that represent off-cluster ("world")
/// traffic. In single-stack clusters this is `2`; dual-stack Cilium splits it
/// into world-ipv4 (`9`) and world-ipv6 (`10`). All three count as external.
const WORLD_IDENTITIES: [u64; 3] = [2, 9, 10];

/// Cilium uses u64::MAX as the "no byte accounting / unmatched" sentinel; the
/// text CLI renders it as "-". Such entries must be skipped, not summed.
const UNCOUNTED: u64 = u64::MAX;

/// TrafficDirection enum values in the policy map key.
const DIR_INGRESS: u64 = 0;
const DIR_EGRESS: u64 = 1;

/// Per-project network byte counters derived from Cilium policy maps. All are
/// cumulative for the endpoint's lifetime (they reset when a pod's endpoint is
/// recreated; downstream delta logic treats a decrease as a reset).
#[derive(Default, Clone, Copy)]
pub struct EgressBytes {
    pub external_egress: f64,
    pub internal_egress: f64,
    pub external_ingress: f64,
    pub internal_ingress: f64,
}

#[derive(Deserialize)]
struct EndpointJson {
    id: i64,
    status: Option<EndpointStatus>,
}

#[derive(Deserialize)]
struct EndpointStatus {
    #[serde(rename = "external-identifiers")]
    external_identifiers: Option<ExternalIdentifiers>,
}

#[derive(Deserialize)]
struct ExternalIdentifiers {
    #[serde(rename = "k8s-namespace")]
    k8s_namespace: Option<String>,
}

#[derive(Deserialize)]
struct PolicyEntry {
    #[serde(rename = "Key")]
    key: PolicyKey,
    #[serde(rename = "Bytes")]
    bytes: u64,
}

#[derive(Deserialize)]
struct PolicyKey {
    #[serde(rename = "Identity")]
    identity: u64,
    #[serde(rename = "TrafficDirection")]
    traffic_direction: u64,
}

/// Reads per-project egress/ingress byte counters from the node-local Cilium
/// agent's policy maps. Only endpoints in `project-<uuid>` namespaces are
/// considered. Returns a map keyed by project UUID string.
///
/// `cilium_dbg` is the path to the cilium-dbg binary (copied from the cilium
/// image by an initContainer). It reads pinned BPF maps directly, so the pod
/// needs `/sys/fs/bpf` mounted and CAP_BPF; `endpoint list` talks to the agent
/// socket under `/var/run/cilium`.
pub async fn read_egress_bytes(cilium_dbg: &str) -> Result<HashMap<String, EgressBytes>> {
    let endpoints = list_project_endpoints(cilium_dbg).await?;
    let mut out: HashMap<String, EgressBytes> = HashMap::new();

    for (ep_id, project_id) in endpoints {
        match read_policy(cilium_dbg, ep_id).await {
            Ok(bytes) => {
                let e = out.entry(project_id).or_default();
                e.external_egress += bytes.external_egress;
                e.internal_egress += bytes.internal_egress;
                e.external_ingress += bytes.external_ingress;
                e.internal_ingress += bytes.internal_ingress;
            }
            Err(e) => tracing::debug!("policy read failed for endpoint {ep_id}: {e}"),
        }
    }
    Ok(out)
}

/// Lists local endpoints, returning (endpoint_id, project_uuid) for each pod in
/// a `project-<uuid>` namespace.
async fn list_project_endpoints(cilium_dbg: &str) -> Result<Vec<(i64, String)>> {
    let output = Command::new(cilium_dbg)
        .args(["endpoint", "list", "-o", "json"])
        .output()
        .await
        .context("run cilium-dbg endpoint list")?;
    if !output.status.success() {
        anyhow::bail!(
            "cilium-dbg endpoint list exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let endpoints: Vec<EndpointJson> =
        serde_json::from_slice(&output.stdout).context("parse endpoint list json")?;

    let mut out = Vec::new();
    for ep in endpoints {
        let Some(ns) = ep
            .status
            .and_then(|s| s.external_identifiers)
            .and_then(|x| x.k8s_namespace)
        else {
            continue;
        };
        let Some(uuid) = ns.strip_prefix("project-") else {
            continue;
        };
        if uuid::Uuid::parse_str(uuid).is_ok() {
            out.push((ep.id, uuid.to_string()));
        }
    }
    Ok(out)
}

/// Reads and classifies the policy map for a single endpoint.
async fn read_policy(cilium_dbg: &str, ep_id: i64) -> Result<EgressBytes> {
    let output = Command::new(cilium_dbg)
        .args(["bpf", "policy", "get", &ep_id.to_string(), "-o", "json"])
        .output()
        .await
        .context("run cilium-dbg bpf policy get")?;
    if !output.status.success() {
        anyhow::bail!("cilium-dbg bpf policy get {ep_id} exited {}", output.status);
    }

    let entries: Vec<PolicyEntry> =
        serde_json::from_slice(&output.stdout).context("parse policy json")?;

    Ok(classify(&entries))
}

fn classify(entries: &[PolicyEntry]) -> EgressBytes {
    let mut b = EgressBytes::default();
    for e in entries {
        if e.bytes == UNCOUNTED {
            continue;
        }
        let value = e.bytes as f64;
        let external = WORLD_IDENTITIES.contains(&e.key.identity);
        match (e.key.traffic_direction, external) {
            (DIR_EGRESS, true) => b.external_egress += value,
            (DIR_EGRESS, false) => b.internal_egress += value,
            (DIR_INGRESS, true) => b.external_ingress += value,
            (DIR_INGRESS, false) => b.internal_ingress += value,
            _ => {}
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(identity: u64, dir: u64, bytes: u64) -> PolicyEntry {
        PolicyEntry {
            key: PolicyKey {
                identity,
                traffic_direction: dir,
            },
            bytes,
        }
    }

    #[test]
    fn classifies_world_and_cluster() {
        let entries = vec![
            entry(2, DIR_EGRESS, 698332),    // external egress
            entry(12961, DIR_EGRESS, 6420),  // internal egress (cluster pod)
            entry(1, DIR_EGRESS, UNCOUNTED), // host, uncounted -> skipped
            entry(2, DIR_INGRESS, 500),      // external ingress
            entry(0, DIR_EGRESS, 16958),     // ANY (DNS) -> internal egress
        ];
        let b = classify(&entries);
        assert_eq!(b.external_egress, 698332.0);
        assert_eq!(b.internal_egress, 6420.0 + 16958.0);
        assert_eq!(b.external_ingress, 500.0);
        assert_eq!(b.internal_ingress, 0.0);
    }
}
