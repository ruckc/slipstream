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
use tracing::{info, warn};

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
            "/bin/bash",
            "-l",
            "-c",
            &proc.command,
        ])
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
        "/bin/bash",
        "-c",
        &req.command,
    ])
    .env("HOME", "/home/agent")
    .env(
        "PATH",
        "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("tmux not found: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(name = %req.name, command = %req.command, stderr = %stderr.trim(), "tmux new-session failed");
        return Err(AppError::Internal(anyhow::anyhow!(
            "tmux new-session failed: {}",
            stderr.trim()
        )));
    }

    info!(name = %req.name, command = %req.command, persistent = req.persistent, "Created tmux session");

    // Keep the pane open after the command exits so its output — including any
    // startup failure — remains visible when the user attaches. Without this a
    // command that fails instantly would close the session before it can be seen.
    let remain = Command::new("tmux")
        .args(["set-option", "-t", &req.name, "remain-on-exit", "on"])
        .env("HOME", "/home/agent")
        .output()
        .await;
    if let Ok(out) = &remain {
        if !out.status.success() {
            warn!(
                name = %req.name,
                stderr = %String::from_utf8_lossy(&out.stderr).trim(),
                "failed to set remain-on-exit"
            );
        }
    }

    // Wait until the session is visible via list-sessions (tmux server may need a moment to settle)
    for attempt in 0..20u32 {
        let visible = running_session_names().await;
        if visible.contains(&req.name) {
            if attempt > 0 {
                info!(attempts = attempt, name = %req.name, "Session became visible after retries");
            }
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(25)).await;
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

    // Retry briefly to handle transient unavailability right after session creation.
    let output = {
        let mut last = None;
        for attempt in 0..5u32 {
            let out = Command::new("tmux")
                .args([
                    "list-sessions",
                    "-F",
                    "#{session_name}|#{session_created}|#{session_activity}|#{session_windows}",
                ])
                .env("HOME", "/home/agent")
                .output()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("tmux not found: {}", e)))?;
            if out.status.success() {
                if attempt > 0 {
                    info!(attempt, "list-sessions succeeded after retry");
                }
                last = Some(out);
                break;
            }
            let stderr = String::from_utf8_lossy(&out.stderr);
            let status = out.status.code().unwrap_or(-1);
            info!(status, attempt, stderr = %stderr.trim(), "list-sessions returned non-zero, retrying");
            last = Some(out);
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
        }
        last.unwrap()
    };

    if !output.status.success() {
        // tmux exits non-zero when there are no sessions — that's normal
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
            let parts: Vec<&str> = line.splitn(4, '|').collect();
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

    if sessions.is_empty() {
        info!(stdout = %String::from_utf8_lossy(&output.stdout).trim(),
              "Listed tmux sessions: count=0 (exit 0 but empty output)");
    } else {
        info!(count = sessions.len(), "Listed tmux sessions");
    }
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
        warn!(name = %name, stderr = %stderr.trim(), "tmux kill-session failed");
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

    info!(name = %name, "Killed tmux session");
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
        info!(name = %name, "Unpinned tmux session (no longer persistent)");
    }

    Ok(Json(json!({ "name": name, "persistent": req.persistent })))
}
