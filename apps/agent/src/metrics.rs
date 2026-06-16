use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::Response};

use crate::AppState;

/// Exposes the only application-level metric the platform still scrapes from
/// the agent: `slipstream_last_activity_at`. Everything else (CPU, memory,
/// disk, network) is now collected node-side by the metrics-collector
/// DaemonSet from the kubelet/cAdvisor and Cilium, so the agent no longer
/// reads cgroups, walks the filesystem, or parses /proc/net/dev.
///
/// The project-controller's idle loop and the metrics-collector both read
/// `slipstream_last_activity_at` to drive idle shutdown and the activity chart.
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
    let mut out = String::with_capacity(128);

    let last_activity_at = state.idle.last_activity_at_unix();
    out.push_str(&format!(
        "slipstream_last_activity_at{label} {last_activity_at:.3}\n"
    ));

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        .body(out)
        .expect("response build failed")
}
