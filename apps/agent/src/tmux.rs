use crate::{
    auth::{require_permission, AuthUser},
    error::AppError,
    AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::process::Command;

#[derive(Deserialize)]
pub struct CreateTmuxRequest {
    pub name: String,
    pub command: String,
}

#[derive(Serialize)]
pub struct TmuxSession {
    pub name: String,
    pub created: u64,
    pub activity: u64,
    pub windows: u32,
}

pub async fn create_tmux_session(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Json(req): Json<CreateTmuxRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;
    state.idle.touch();

    if req.name.is_empty()
        || req.name.len() > 64
        || !req
            .name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "name must be 1-64 alphanumeric/dash/underscore characters".into(),
        ));
    }
    if req.command.trim().is_empty() {
        return Err(AppError::BadRequest("command is required".into()));
    }

    // Single-quote-escape the user command so it survives the bash -lc wrapper.
    let escaped_cmd = req.command.replace('\'', "'\\''");
    let shell_cmd = format!("/bin/bash -l -c '{escaped_cmd}'");

    let output = Command::new("tmux")
        .args([
            "new-session",
            "-d",
            "-s",
            &req.name,
            "-x",
            "220",
            "-y",
            "50",
        ])
        .arg(&shell_cmd)
        .env("HOME", "/home/agent")
        .output()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("tmux not found: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(anyhow::anyhow!(
            "tmux new-session failed: {}",
            stderr.trim()
        )));
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "name": req.name })),
    ))
}

pub async fn list_tmux_sessions(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;
    state.idle.touch();

    let output = Command::new("tmux")
        .args([
            "list-sessions",
            "-F",
            "#{session_name}\t#{session_created}\t#{session_activity}\t#{session_windows}",
        ])
        .env("HOME", "/home/agent")
        .output()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("tmux not found: {}", e)))?;

    if !output.status.success() {
        // No sessions running — not an error.
        return Ok(Json(json!({ "sessions": [] })));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let sessions: Vec<TmuxSession> = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '\t').collect();
            if parts.len() < 4 {
                return None;
            }
            Some(TmuxSession {
                name: parts[0].to_string(),
                created: parts[1].parse().unwrap_or(0),
                activity: parts[2].parse().unwrap_or(0),
                windows: parts[3].parse().unwrap_or(0),
            })
        })
        .collect();

    Ok(Json(json!({ "sessions": sessions })))
}

pub async fn kill_tmux_session(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;
    state.idle.touch();

    let output = Command::new("tmux")
        .args(["kill-session", "-t", &name])
        .env("HOME", "/home/agent")
        .output()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("tmux not found: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::NotFound(format!(
            "tmux session '{}' not found: {}",
            name,
            stderr.trim()
        )));
    }

    Ok(Json(json!({ "killed": name })))
}
