use anyhow::{Context, Result};
use k8s_openapi::api::core::v1::{PersistentVolumeClaim, Pod};
use kube::{
    api::{Api, ListParams},
    Client,
};

/// Label set by the project-controller on every project pod.
pub const PROJECT_ID_LABEL: &str = "slipstream.io/project-id";

/// A running project pod scheduled on this node.
pub struct PodTarget {
    pub project_id: String,
    pub namespace: String,
    pub pod_name: String,
    pub pod_ip: String,
}

/// Lists Running project pods scheduled on `node_name`. The field selector
/// restricts the query server-side so each DaemonSet replica only ever sees
/// its own node's pods — no sharding logic required.
pub async fn list_node_project_pods(client: &Client, node_name: &str) -> Result<Vec<PodTarget>> {
    let api: Api<Pod> = Api::all(client.clone());
    let lp = ListParams::default()
        .labels(PROJECT_ID_LABEL)
        .fields(&format!("spec.nodeName={node_name},status.phase=Running"));
    let pods = api.list(&lp).await.context("list pods on node")?;

    let mut out = Vec::new();
    for p in pods {
        let Some(project_id) = p
            .metadata
            .labels
            .as_ref()
            .and_then(|l| l.get(PROJECT_ID_LABEL))
            .cloned()
        else {
            continue;
        };
        let namespace = p.metadata.namespace.clone().unwrap_or_default();
        let pod_name = p.metadata.name.clone().unwrap_or_default();
        let pod_ip = p
            .status
            .as_ref()
            .and_then(|s| s.pod_ip.clone())
            .unwrap_or_default();
        if pod_ip.is_empty() {
            continue;
        }
        out.push(PodTarget {
            project_id,
            namespace,
            pod_name,
            pod_ip,
        });
    }
    Ok(out)
}

/// Sums the allocated capacity (`.status.capacity.storage`) of all PVCs in a
/// project namespace. Billing is on allocated size, not consumed bytes, which
/// is exactly what the cluster operator pays for.
pub async fn pvc_capacity_bytes(client: &Client, namespace: &str) -> Result<u64> {
    let api: Api<PersistentVolumeClaim> = Api::namespaced(client.clone(), namespace);
    let pvcs = api
        .list(&ListParams::default())
        .await
        .context("list pvcs")?;

    let mut total = 0u64;
    for pvc in pvcs {
        let cap = pvc
            .status
            .and_then(|s| s.capacity)
            .and_then(|c| c.get("storage").cloned());
        if let Some(q) = cap {
            total += parse_quantity_bytes(&q.0).unwrap_or(0);
        }
    }
    Ok(total)
}

/// Parses a Kubernetes resource quantity (e.g. "10Gi", "500M", "1073741824")
/// into bytes. Supports binary (Ki/Mi/Gi/Ti/Pi) and decimal (k/M/G/T/P) suffixes.
fn parse_quantity_bytes(s: &str) -> Option<u64> {
    let s = s.trim();
    let (num, mult): (&str, f64) = if let Some(n) = s.strip_suffix("Ki") {
        (n, 1024.0)
    } else if let Some(n) = s.strip_suffix("Mi") {
        (n, 1024.0 * 1024.0)
    } else if let Some(n) = s.strip_suffix("Gi") {
        (n, 1024.0 * 1024.0 * 1024.0)
    } else if let Some(n) = s.strip_suffix("Ti") {
        (n, 1024f64.powi(4))
    } else if let Some(n) = s.strip_suffix("Pi") {
        (n, 1024f64.powi(5))
    } else if let Some(n) = s.strip_suffix('k') {
        (n, 1e3)
    } else if let Some(n) = s.strip_suffix('M') {
        (n, 1e6)
    } else if let Some(n) = s.strip_suffix('G') {
        (n, 1e9)
    } else if let Some(n) = s.strip_suffix('T') {
        (n, 1e12)
    } else if let Some(n) = s.strip_suffix('P') {
        (n, 1e15)
    } else {
        (s, 1.0)
    };
    num.trim().parse::<f64>().ok().map(|v| (v * mult) as u64)
}

#[cfg(test)]
mod tests {
    use super::parse_quantity_bytes;

    #[test]
    fn parses_quantities() {
        assert_eq!(parse_quantity_bytes("10Gi"), Some(10 * 1024 * 1024 * 1024));
        assert_eq!(parse_quantity_bytes("500Mi"), Some(500 * 1024 * 1024));
        assert_eq!(parse_quantity_bytes("1073741824"), Some(1073741824));
        assert_eq!(parse_quantity_bytes("1G"), Some(1_000_000_000));
    }
}
