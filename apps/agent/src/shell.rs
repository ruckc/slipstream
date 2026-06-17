use crate::{
    auth::{require_permission, AuthUser, AuthUserWs},
    error::AppError,
    AppState,
};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::IntoResponse,
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const OUTPUT_RING_MAX: usize = 2000;

pub struct Session {
    pub session_id: String,
    pub pty_master: Box<dyn MasterPty + Send>,
    pub pty_writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Box<dyn Child + Send + Sync>,
    pub output_buf: VecDeque<(u64, Bytes)>,
    pub next_seq: u64,
    pub created_at: DateTime<Utc>,
    pub active_connections: Arc<AtomicUsize>,
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

pub struct SessionStore {
    pub sessions: DashMap<String, Arc<Mutex<Session>>>,
    pub workspace_path: std::path::PathBuf,
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub created_at: DateTime<Utc>,
    pub active_connections: usize,
    pub process_name: Option<String>,
}

impl SessionStore {
    pub fn new(workspace_path: std::path::PathBuf) -> Self {
        Self {
            sessions: DashMap::new(),
            workspace_path,
        }
    }

    pub fn create(
        &self,
        command: Option<Vec<String>>,
        working_dir: Option<String>,
    ) -> anyhow::Result<String> {
        let session_id = Uuid::new_v4().to_string();
        self.create_with_id(&session_id, command, working_dir)?;
        Ok(session_id)
    }

    /// Build a session under a caller-supplied id and register it. Used both by
    /// `create` (random id) and by the WS attach path, which recreates a session
    /// under the same id the client is reconnecting to after the agent container
    /// was restarted (e.g. by a project-controller reconcile) and lost its
    /// in-memory sessions — avoiding an infinite client reconnect loop.
    pub fn create_with_id(
        &self,
        session_id: &str,
        command: Option<Vec<String>>,
        working_dir: Option<String>,
    ) -> anyhow::Result<Arc<Mutex<Session>>> {
        let pty_system = NativePtySystem::default();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow::anyhow!("Failed to open PTY: {}", e))?;

        let workspace = self.workspace_path.clone();
        let requested = working_dir.unwrap_or_else(|| workspace.to_string_lossy().into_owned());
        let cwd_path = std::fs::canonicalize(&requested).unwrap_or_else(|_| {
            // Path doesn't exist yet; validate by canonicalizing the parent.
            let p = std::path::Path::new(&requested);
            p.parent()
                .and_then(|parent| std::fs::canonicalize(parent).ok())
                .unwrap_or_else(|| workspace.clone())
        });
        let cwd = if cwd_path.starts_with(&workspace) {
            requested
        } else {
            return Err(anyhow::anyhow!(
                "working_dir '{}' is outside the workspace",
                requested
            ));
        };

        // Build the shell invocation. If a command is provided, use
        // `bash -c "exec <cmd>"` so $PATH resolution happens inside the shell
        // and the target process replaces bash as the PTY child.
        let mut cmd = CommandBuilder::new("/bin/bash");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("HOME", "/home/agent");
        cmd.env("SHELL", "/bin/bash");
        cmd.cwd(&cwd);
        if let Some(ref args) = command {
            if !args.is_empty() {
                // Shell-quote each argument conservatively by wrapping in single
                // quotes and escaping any embedded single quotes.
                let escaped: Vec<String> = args
                    .iter()
                    .map(|a| format!("'{}'", a.replace('\'', "'\\''")))
                    .collect();
                // -l: login shell so /etc/profile.d/ is sourced (mise activation)
                cmd.args(["-lc", &format!("exec {}", escaped.join(" "))]);
            } else {
                // Interactive login shell — sources /etc/profile.d/mise.sh
                cmd.arg("-l");
            }
        } else {
            cmd.arg("-l");
        }

        // Try bash first, fall back to sh (only for the default shell case).
        let child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                if command.is_some() {
                    return Err(anyhow::anyhow!("Failed to spawn command: {}", e));
                }
                let mut fallback = CommandBuilder::new("/bin/sh");
                fallback.cwd(&cwd);
                fallback.env("TERM", "xterm-256color");
                pair.slave
                    .spawn_command(fallback)
                    .map_err(|e| anyhow::anyhow!("Failed to spawn shell: {}", e))?
            }
        };

        let pty_writer = pair
            .master
            .take_writer()
            .map_err(|e| anyhow::anyhow!("Failed to take PTY writer: {}", e))?;

        let session = Session {
            session_id: session_id.to_string(),
            pty_writer: Arc::new(Mutex::new(pty_writer)),
            pty_master: pair.master,
            child,
            output_buf: VecDeque::new(),
            next_seq: 0,
            created_at: Utc::now(),
            active_connections: Arc::new(AtomicUsize::new(0)),
        };

        let arc = Arc::new(Mutex::new(session));
        self.sessions.insert(session_id.to_string(), arc.clone());

        info!("Created session {}", session_id);
        Ok(arc)
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions
            .iter()
            .map(|entry| {
                let s = entry.value().lock();
                let process_name = s.child.process_id().and_then(|pid| {
                    std::fs::read_to_string(format!("/proc/{}/comm", pid))
                        .ok()
                        .map(|s| s.trim().to_string())
                });
                SessionInfo {
                    session_id: s.session_id.clone(),
                    created_at: s.created_at,
                    active_connections: s.active_connections.load(Ordering::Relaxed),
                    process_name,
                }
            })
            .collect()
    }

    pub fn kill(&self, id: &str) -> bool {
        if let Some((_, arc)) = self.sessions.remove(id) {
            let mut s = arc.lock();
            if let Err(e) = s.child.kill() {
                warn!("Error killing session {}: {}", id, e);
            }
            info!("Killed session {}", id);
            true
        } else {
            false
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<Mutex<Session>>> {
        self.sessions.get(id).map(|r| r.value().clone())
    }

    pub fn active_connections(&self) -> usize {
        self.sessions
            .iter()
            .map(|entry| {
                entry
                    .value()
                    .lock()
                    .active_connections
                    .load(Ordering::Relaxed)
            })
            .sum()
    }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
pub struct CreateSessionRequest {
    pub command: Option<Vec<String>>,
    pub working_dir: Option<String>,
    #[allow(dead_code)]
    pub label: Option<String>,
}

pub async fn create_session(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    body: Option<Json<CreateSessionRequest>>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;
    state.idle.touch();

    let req = body.map(|b| b.0).unwrap_or_default();
    let session_id = state
        .sessions
        .create(req.command, req.working_dir)
        .map_err(AppError::Internal)?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"session_id": session_id})),
    ))
}

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;
    state.idle.touch();

    let sessions = state.sessions.list();
    Ok(Json(json!({"sessions": sessions})))
}

pub async fn kill_session(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;
    state.idle.touch();

    if state.sessions.kill(&id) {
        Ok(Json(json!({"killed": id})))
    } else {
        Err(AppError::NotFound(format!("Session '{}' not found", id)))
    }
}

// ---------------------------------------------------------------------------
// WebSocket attach
// ---------------------------------------------------------------------------

pub async fn ws_attach(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    AuthUserWs(claims): AuthUserWs,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "shell")?;

    // If the session is gone — typically because the agent container was
    // restarted by a project-controller reconcile and lost its in-memory
    // sessions — recreate a fresh one under the same id instead of returning
    // 404. That stops the client from spinning in an infinite reconnect loop
    // and gives it a working shell again (with empty scrollback).
    let session_arc = match state.sessions.get(&id) {
        Some(s) => s,
        None => {
            info!("Session '{}' not found on attach; recreating", id);
            state
                .sessions
                .create_with_id(&id, None, None)
                .map_err(AppError::Internal)?
        }
    };

    state.idle.touch();

    Ok(ws.on_upgrade(move |socket| handle_ws(socket, session_arc, state)))
}

async fn handle_ws(socket: WebSocket, session_arc: Arc<Mutex<Session>>, state: Arc<AppState>) {
    // Extract active_connections Arc, pty reader/writer before any async work.
    let (active_connections, pty_reader, pty_writer, session_id) = {
        let session = session_arc.lock();

        let reader = match session.pty_master.try_clone_reader() {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to clone PTY reader: {}", e);
                return;
            }
        };

        (
            session.active_connections.clone(),
            reader,
            session.pty_writer.clone(),
            session.session_id.clone(),
        )
    };

    active_connections.fetch_add(1, Ordering::Relaxed);
    info!("WS attached to session {}", session_id);

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Channel forwards both PTY output and pong frames to the WS sender.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Message>(256);

    // --- Task 1: PTY reader → channel ---
    let session_arc_reader = session_arc.clone();
    let state_reader = state.clone();
    let out_tx_reader = out_tx.clone();
    let pty_read_task = tokio::task::spawn_blocking(move || {
        let mut reader = pty_reader;
        let rt = tokio::runtime::Handle::current();
        let mut buf = [0u8; 4096];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    debug!("PTY reader EOF");
                    break;
                }
                Ok(n) => {
                    let data = Bytes::copy_from_slice(&buf[..n]);
                    let encoded = BASE64.encode(&data);

                    let seq = {
                        let mut session = session_arc_reader.lock();
                        let seq = session.next_seq;
                        session.next_seq += 1;
                        session.output_buf.push_back((seq, data));
                        if session.output_buf.len() > OUTPUT_RING_MAX {
                            session.output_buf.pop_front();
                        }
                        seq
                    };

                    state_reader.idle.touch();

                    let msg = json!({
                        "type": "output",
                        "seq": seq,
                        "data": encoded,
                    })
                    .to_string();

                    if rt
                        .block_on(out_tx_reader.send(Message::Text(msg.into())))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(e) => {
                    debug!("PTY read error: {}", e);
                    break;
                }
            }
        }
    });

    // --- Task 2: channel → WS sender ---
    let ws_send_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
        // Attempt a clean close.
        let _ = ws_sink.close().await;
    });

    // --- Main loop: WS receiver → PTY input / resize / replay ---
    while let Some(result) = ws_stream.next().await {
        let msg = match result {
            Ok(m) => m,
            Err(e) => {
                debug!("WS receive error: {}", e);
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                let v: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("Invalid WS JSON: {}", e);
                        continue;
                    }
                };

                match v.get("type").and_then(|t| t.as_str()) {
                    Some("input") => {
                        if let Some(encoded) = v.get("data").and_then(|d| d.as_str()) {
                            match BASE64.decode(encoded) {
                                Ok(bytes) => {
                                    state.idle.touch();
                                    let mut writer = pty_writer.lock();
                                    if let Err(e) = writer.write_all(&bytes) {
                                        warn!("PTY write error: {}", e);
                                    }
                                }
                                Err(e) => warn!("Failed to decode input base64: {}", e),
                            }
                        }
                    }

                    Some("resize") => {
                        let cols = v.get("cols").and_then(|c| c.as_u64()).unwrap_or(80) as u16;
                        let rows = v.get("rows").and_then(|r| r.as_u64()).unwrap_or(24) as u16;

                        let session = session_arc.lock();
                        if let Err(e) = session.pty_master.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        }) {
                            warn!("PTY resize error: {}", e);
                        }
                    }

                    Some("replay_from") => {
                        let from_seq = v.get("seq").and_then(|s| s.as_u64()).unwrap_or(0);
                        let replay_msgs: Vec<Message> = {
                            let session = session_arc.lock();
                            session
                                .output_buf
                                .iter()
                                .filter(|(seq, _)| *seq >= from_seq)
                                .map(|(seq, data)| {
                                    Message::Text(
                                        json!({
                                            "type": "output",
                                            "seq": seq,
                                            "data": BASE64.encode(data),
                                        })
                                        .to_string()
                                        .into(),
                                    )
                                })
                                .collect::<Vec<_>>()
                        };

                        for replay_msg in replay_msgs {
                            if out_tx.send(replay_msg).await.is_err() {
                                break;
                            }
                        }
                    }

                    other => {
                        warn!("Unknown WS message type: {:?}", other);
                    }
                }
            }

            Message::Close(_) => {
                debug!("WS close frame for session {}", session_id);
                break;
            }

            Message::Ping(data) => {
                // Respond with Pong carrying the same payload.
                if out_tx.send(Message::Pong(data)).await.is_err() {
                    break;
                }
            }

            _ => {}
        }
    }

    // Decrement connection count; session stays alive.
    active_connections.fetch_sub(1, Ordering::Relaxed);
    info!("WS detached from session {}", session_id);

    // Shut down background tasks.
    pty_read_task.abort();
    ws_send_task.abort();
}
