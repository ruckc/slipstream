use anyhow::{Context, Result};
use k8s_openapi::api::apps::v1::StatefulSet;
use kube::{
    api::{Api, DynamicObject, ListParams},
    discovery::ApiResource,
    Client,
};
use serde_json::Value;

pub struct ProjectTarget {
    pub project_id: String,
}

pub async fn list_running_projects(client: &Client) -> Result<Vec<ProjectTarget>> {
    let ar = ApiResource {
        group: "slipstream.io".into(),
        version: "v1alpha1".into(),
        kind: "ProjectEnvironment".into(),
        api_version: "slipstream.io/v1alpha1".into(),
        plural: "projectenvironments".into(),
    };
    // PEs are created in the controller namespace — use cluster-scoped listing.
    let api: Api<DynamicObject> = Api::all_with(client.clone(), &ar);
    let items = api
        .list(&ListParams::default())
        .await
        .context("list ProjectEnvironments")?;

    let mut targets = Vec::new();
    for item in items {
        let phase = item
            .data
            .get("status")
            .and_then(|s| s.get("phase"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if phase != "Running" {
            continue;
        }
        let project_id = item
            .data
            .get("spec")
            .and_then(|s| s.get("projectId"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if project_id.is_empty() {
            continue;
        }
        targets.push(ProjectTarget { project_id });
    }
    Ok(targets)
}

/// Returns the current desired replica count for this collector's StatefulSet.
/// Falls back to 1 if the StatefulSet or replicas field is not found.
pub async fn get_replica_count(client: &Client, namespace: &str, sts_name: &str) -> u32 {
    let api: Api<StatefulSet> = Api::namespaced(client.clone(), namespace);
    match api.get(sts_name).await {
        Ok(sts) => sts
            .spec
            .as_ref()
            .and_then(|s| s.replicas)
            .map(|r| r as u32)
            .unwrap_or(1),
        Err(e) => {
            tracing::warn!("could not get StatefulSet {sts_name}: {e}; assuming 1 replica");
            1
        }
    }
}
