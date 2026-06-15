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
use std::{path::PathBuf, sync::Arc};
use tokio::process::Command;

// ---------------------------------------------------------------------------
// Persistent process store
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct PersistentProcess {
    pub name: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
}

fn processes_file(home_path: &std::path::Path) -> PathBuf {
    home_path.join(".slipstream").join("processes.json")
}

fn load_persistent(home_path: &std::path::Path) -> Vec<PersistentProcess> {
    let path = processes_file(home_path);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn save_persistent(home_path: &std::path::Path, procs: &[PersistentProcess]) {
    let path = processes_file(home_path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(procs) {
        let _ = std::fs::write(&path, bytes);
    }
}

// ---------------------------------------------------------------------------
// Restore persistent processes on startup
// ---------------------------------------------------------------------------

pub async fn restore_persistent_processes(state: &Arc<AppState>) {
    let procs = load_persistent(&state.config.home_path);
    if procs.is_empty() {
        return;
    }

    // Get currently running sessions so we don't double-start them.
    let running = running_session_names().await;

    for proc in &procs {
        if running.contains(&proc.name) {
            continue;
        }
        let escaped_cmd = proc.command.replace('\'', "'\\''");
        let shell_cmd = format!("/bin/bash -l -c '{escaped_cmd}'");
        let workspace = state.config.workspace_path.to_string_lossy().to_string();
        let cwd = proc
            .working_dir
            .as_deref()
            .unwrap_or(&workspace)
            .to_string();

        let mut cmd = Command::new("tmux");
        cmd.args([
            "new-session",
            "-d",
            "-s",
            &proc.name,
            "-x",
            "220",
            "-y",
            "50",
            "-c",
            &cwd,
        ])
        .arg(&shell_cmd)
        .env("HOME", "/home/agent");

        match cmd.output().await {
            Ok(out) if out.status.success() => {
                tracing::info!(name = %proc.name, "Restored persistent process");
            }
            Ok(out) => {
                tracing::warn!(
                    name = %proc.name,
                    stderr = %String::from_utf8_lossy(&out.stderr).trim(),
                    "Failed to restore persistent process"
                );
            }
            Err(e) => {
                tracing::warn!(name = %proc.name, err = %e, "tmux not available for restore");
            }
        }
    }
}

async fn running_session_names() -> Vec<String> {
    let Ok(out) = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .env("HOME", "/home/agent")
        .output()
        .await
    else {
        return vec![];
    };
    if !out.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateTmuxRequest {
    pub name: String,
    pub command: String,
    pub working_dir: Option<String>,
    #[serde(default)]
    pub persistent: bool,
}

#[derive(Serialize)]
pub struct TmuxSession {
    pub name: String,
    pub created: u64,
    pub activity: u64,
    pub windows: u32,
    pub persistent: bool,
}

#[derive(Deserialize)]
pub struct PatchTmuxRequest {
    pub persistent: bool,
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

    let escaped_cmd = req.command.replace('\'', "'\\''");
    let shell_cmd = format!("/bin/bash -l -c '{escaped_cmd}'");

    let workspace = state.config.workspace_path.to_string_lossy();
    let cwd = req.working_dir.as_deref().unwrap_or(&workspace);

    let mut cmd = Command::new("tmux");
    cmd.args([
        "new-session",
        "-d",
        "-s",
        &req.name,
        "-x",
        "220",
        "-y",
        "50",
        "-c",
        cwd,
    ])
    .arg(&shell_cmd)
    .env("HOME", "/home/agent");

    let output = cmd
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

    if req.persistent {
        let mut procs = load_persistent(&state.config.home_path);
        if !procs.iter().any(|p| p.name == req.name) {
            procs.push(PersistentProcess {
                name: req.name.clone(),
                command: req.command.clone(),
                working_dir: req.working_dir.clone(),
            });
            save_persistent(&state.config.home_path, &procs);
        }
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
        return Ok(Json(json!({ "sessions": [] })));
    }

    let persistent_names: Vec<String> = load_persistent(&state.config.home_path)
        .into_iter()
        .map(|p| p.name)
        .collect();

    let stdout = String::from_utf8_lossy(&output.stdout);
    let sessions: Vec<TmuxSession> = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '\t').collect();
            if parts.len() < 4 {
                return None;
            }
            let name = parts[0].to_string();
            let persistent = persistent_names.contains(&name);
            Some(TmuxSession {
                name,
                created: parts[1].parse().unwrap_or(0),
                activity: parts[2].parse().unwrap_or(0),
                windows: parts[3].parse().unwrap_or(0),
                persistent,
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

    // Remove from persistent list if present.
    let mut procs = load_persistent(&state.config.home_path);
    let before = procs.len();
    procs.retain(|p| p.name != name);
    if procs.len() != before {
        save_persistent(&state.config.home_path, &procs);
    }

    Ok(Json(json!({ "killed": name })))
}

pub async fn patch_tmux_session(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Path(name): Path<String>,
    Json(req): Json<PatchTmuxRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;
    state.idle.touch();

    // Verify the session exists.
    let running = running_session_names().await;
    if !running.contains(&name) {
        return Err(AppError::NotFound(format!(
            "tmux session '{}' not found",
            name
        )));
    }

    let mut procs = load_persistent(&state.config.home_path);

    if req.persistent {
        if !procs.iter().any(|p| p.name == name) {
            // We need the command to persist it; get it from tmux.
            // Store name-only entry — user can re-create with full command if needed.
            // Actually we can't get the command from tmux easily, so we'll just
            // store a marker with an empty command that re-attaches.
            // Better: refuse to pin via patch if we don't know the command.
            return Err(AppError::BadRequest(
                "Cannot make an existing session persistent without its original command. \
                 Create the session with persistent=true instead."
                    .into(),
            ));
        }
    } else {
        procs.retain(|p| p.name != name);
        save_persistent(&state.config.home_path, &procs);
    }

    Ok(Json(json!({ "name": name, "persistent": req.persistent })))
}
