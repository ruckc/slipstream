use crate::{
    auth::{require_permission, AuthUser, AuthUserWs},
    error::AppError,
    AppState,
};
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use ignore::{
    gitignore::{Gitignore, GitignoreBuilder},
    WalkBuilder,
};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{debug, info, warn};

#[derive(Deserialize)]
pub struct MoveBody {
    pub from: String,
    pub to: String,
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

fn safe_path(workspace: &Path, user_path: &str) -> Result<PathBuf, AppError> {
    // Reject raw .. components before any resolution.
    if user_path.split('/').any(|c| c == "..") {
        return Err(AppError::Forbidden("Path traversal not allowed".into()));
    }

    let trimmed = user_path.trim_start_matches('/');
    let joined = workspace.join(trimmed);

    // For existing paths, canonicalize to resolve symlinks.
    // For non-existent paths, canonicalize the nearest existing ancestor
    // to ensure the resolved parent is still within the workspace.
    let canonical = if joined.exists() {
        joined
            .canonicalize()
            .map_err(|e| AppError::Internal(e.into()))?
    } else {
        let parent = joined.parent().unwrap_or(workspace);
        let resolved_parent = parent
            .canonicalize()
            .unwrap_or_else(|_| workspace.to_path_buf());
        resolved_parent.join(joined.file_name().unwrap_or_default())
    };

    if !canonical.starts_with(workspace) {
        return Err(AppError::Forbidden("Path traversal not allowed".into()));
    }

    // Return joined (not canonical) so non-existent paths work for upload/mkdir.
    Ok(joined)
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: String,
}

// ---------------------------------------------------------------------------
// list_dir: GET /fs?path=/some/dir
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct DirEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
    size: u64,
    modified: String,
}

pub async fn list_dir(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Query(params): Query<PathQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "files:read")?;
    state.idle.touch();

    let dir_path = safe_path(&state.config.workspace_path, &params.path)?;

    let mut read_dir = tokio::fs::read_dir(&dir_path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!("Directory not found: {}", params.path))
        } else {
            AppError::Internal(e.into())
        }
    })?;

    let mut entries = Vec::new();

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    {
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(e) => {
                debug!("Skipping entry, failed to read metadata: {}", e);
                continue;
            }
        };

        let name = entry.file_name().to_string_lossy().to_string();

        let entry_type = if metadata.is_dir() {
            "dir".to_string()
        } else {
            "file".to_string()
        };

        let size = if metadata.is_file() {
            metadata.len()
        } else {
            0
        };

        let modified: DateTime<Utc> = metadata.modified().map(|t| t.into()).unwrap_or(Utc::now());

        entries.push(DirEntry {
            name,
            entry_type,
            size,
            modified: modified.to_rfc3339(),
        });
    }

    entries.sort_by(|a, b| {
        // Dirs first, then by name.
        match (a.entry_type.as_str(), b.entry_type.as_str()) {
            ("dir", "file") => std::cmp::Ordering::Less,
            ("file", "dir") => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(Json(json!({"entries": entries})))
}

// ---------------------------------------------------------------------------
// download_file: GET /fs/download?path=/some/file
// Supports Range header for chunked downloads.
// ---------------------------------------------------------------------------

pub async fn download_file(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Query(params): Query<PathQuery>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "files:read")?;
    state.idle.touch();

    let file_path = safe_path(&state.config.workspace_path, &params.path)?;

    let metadata = tokio::fs::metadata(&file_path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!("File not found: {}", params.path))
        } else {
            AppError::Internal(e.into())
        }
    })?;

    if !metadata.is_file() {
        return Err(AppError::BadRequest(format!(
            "'{}' is not a file",
            params.path
        )));
    }

    let file_size = metadata.len();

    // Parse Range header: `bytes=START-END`
    let range_header = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let (start, end, is_range) = if let Some(range) = range_header {
        if let Some(range_str) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_str.splitn(2, '-').collect();
            if parts.len() == 2 {
                let start = parts[0].parse::<u64>().unwrap_or(0);
                let end = if parts[1].is_empty() {
                    file_size.saturating_sub(1)
                } else {
                    parts[1]
                        .parse::<u64>()
                        .unwrap_or(file_size.saturating_sub(1))
                };
                if start > end || end >= file_size {
                    return Err(AppError::BadRequest("Invalid Range header".to_string()));
                }
                (start, end, true)
            } else {
                (0, file_size.saturating_sub(1), false)
            }
        } else {
            (0, file_size.saturating_sub(1), false)
        }
    } else {
        (0, file_size.saturating_sub(1), false)
    };

    let content_length = end - start + 1;

    // Stream the file in 64 KiB chunks.
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(16);
    let file_path_clone = file_path.clone();

    tokio::spawn(async move {
        let mut file = match tokio::fs::File::open(&file_path_clone).await {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.send(Err(e)).await;
                return;
            }
        };

        // Seek to start.
        use tokio::io::AsyncSeekExt;
        if start > 0 {
            if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
                let _ = tx.send(Err(e)).await;
                return;
            }
        }

        let mut remaining = content_length;
        let chunk_size: u64 = 65536;
        let mut buf = vec![0u8; chunk_size as usize];

        while remaining > 0 {
            let to_read = remaining.min(chunk_size) as usize;
            match file.read(&mut buf[..to_read]).await {
                Ok(0) => break,
                Ok(n) => {
                    remaining -= n as u64;
                    let chunk = Bytes::copy_from_slice(&buf[..n]);
                    if tx.send(Ok(chunk)).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                    break;
                }
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);

    let filename = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());

    let mut response_headers = axum::http::HeaderMap::new();
    response_headers.insert(
        header::CONTENT_LENGTH,
        content_length.to_string().parse().unwrap(),
    );
    response_headers.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    response_headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", filename)
            .parse()
            .unwrap(),
    );
    response_headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());

    if is_range {
        response_headers.insert(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, end, file_size)
                .parse()
                .unwrap(),
        );
        Ok((StatusCode::PARTIAL_CONTENT, response_headers, body).into_response())
    } else {
        Ok((StatusCode::OK, response_headers, body).into_response())
    }
}

// ---------------------------------------------------------------------------
// delete_path: DELETE /fs?path=/some/path
// ---------------------------------------------------------------------------

pub async fn delete_path(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Query(params): Query<PathQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "files:write")?;
    state.idle.touch();

    let target_path = safe_path(&state.config.workspace_path, &params.path)?;

    let metadata = tokio::fs::metadata(&target_path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!("Path not found: {}", params.path))
        } else {
            AppError::Internal(e.into())
        }
    })?;

    if metadata.is_dir() {
        tokio::fs::remove_dir_all(&target_path)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
    } else {
        tokio::fs::remove_file(&target_path)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
    }

    info!("Deleted '{}'", params.path);
    Ok(Json(json!({"deleted": params.path})))
}

// ---------------------------------------------------------------------------
// create_dir: POST /fs/mkdir?path=/some/dir
// ---------------------------------------------------------------------------

pub async fn create_dir(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Query(params): Query<PathQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "files:write")?;
    state.idle.touch();

    let dir_path = safe_path(&state.config.workspace_path, &params.path)?;

    tokio::fs::create_dir_all(&dir_path)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    info!("Created directory '{}'", params.path);
    Ok((StatusCode::CREATED, Json(json!({"created": params.path}))))
}

// ---------------------------------------------------------------------------
// write_file: PUT /fs/write?path=/some/file
// Creates or overwrites a file. Supports Content-Range for chunked/resumable
// uploads of arbitrarily large files. Without Content-Range the body is
// streamed directly to disk (no memory buffering).
//
// Resume: send HEAD or GET /fs?path=<file> to learn the current byte offset,
// then resume with Content-Range: bytes <offset>-<end>/<total>.
// ---------------------------------------------------------------------------

pub async fn write_file(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Query(params): Query<PathQuery>,
    headers: HeaderMap,
    body: axum::body::Body,
) -> Result<impl IntoResponse, AppError> {
    use futures_util::StreamExt;
    use tokio::io::{AsyncSeekExt, AsyncWriteExt};

    require_permission(&claims, "files:write")?;
    state.idle.touch();

    let file_path = safe_path(&state.config.workspace_path, &params.path)?;

    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
    }

    let content_range = headers
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(range_str) = content_range {
        if let Some(rest) = range_str.strip_prefix("bytes ") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            if parts.len() == 2 {
                let range_parts: Vec<&str> = parts[0].splitn(2, '-').collect();
                let total: u64 = parts[1]
                    .parse()
                    .map_err(|_| AppError::BadRequest("Invalid Content-Range: bad total".into()))?;

                if range_parts.len() == 2 {
                    let start: u64 = range_parts[0].parse().map_err(|_| {
                        AppError::BadRequest("Invalid Content-Range: bad start".into())
                    })?;
                    let end: u64 = range_parts[1].parse().map_err(|_| {
                        AppError::BadRequest("Invalid Content-Range: bad end".into())
                    })?;

                    if end < start {
                        return Err(AppError::BadRequest(
                            "Content-Range: end must be >= start".into(),
                        ));
                    }
                    if end >= total {
                        return Err(AppError::BadRequest(
                            "Content-Range: end must be < total".into(),
                        ));
                    }

                    let mut file = if start == 0 {
                        tokio::fs::OpenOptions::new()
                            .create(true)
                            .write(true)
                            .truncate(true)
                            .open(&file_path)
                            .await
                            .map_err(|e| AppError::Internal(e.into()))?
                    } else {
                        tokio::fs::OpenOptions::new()
                            .create(true)
                            .write(true)
                            .truncate(false)
                            .open(&file_path)
                            .await
                            .map_err(|e| AppError::Internal(e.into()))?
                    };

                    file.seek(std::io::SeekFrom::Start(start))
                        .await
                        .map_err(|e| AppError::Internal(e.into()))?;

                    let mut stream = body.into_data_stream();
                    let mut written: u64 = 0;
                    while let Some(chunk) = stream.next().await {
                        let chunk =
                            chunk.map_err(|e| AppError::Internal(anyhow::anyhow!("{e}")))?;
                        file.write_all(&chunk)
                            .await
                            .map_err(|e| AppError::Internal(e.into()))?;
                        written += chunk.len() as u64;
                    }

                    let received = start + written;
                    let complete = received >= total;

                    info!(
                        "Write chunk {}-{}/{} for '{}', complete={}",
                        start,
                        start + written.saturating_sub(1),
                        total,
                        params.path,
                        complete
                    );

                    return Ok((
                        StatusCode::OK,
                        Json(json!({"received": received, "complete": complete})),
                    )
                        .into_response());
                }
            }
        }
        return Err(AppError::BadRequest(
            "Invalid Content-Range header".to_string(),
        ));
    }

    // No Content-Range — stream entire body directly to disk.
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&file_path)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let mut stream = body.into_data_stream();
    let mut received: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Internal(anyhow::anyhow!("{e}")))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        received += chunk.len() as u64;
    }

    info!("Wrote '{}' ({} bytes)", params.path, received);
    Ok((
        StatusCode::CREATED,
        Json(json!({"received": received, "complete": true})),
    )
        .into_response())
}

// ---------------------------------------------------------------------------
// move_path: POST /fs/move  body: {"from": "/old", "to": "/new"}
// ---------------------------------------------------------------------------

pub async fn move_path(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Json(body): Json<MoveBody>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "files:write")?;
    state.idle.touch();

    let from_path = safe_path(&state.config.workspace_path, &body.from)?;
    let to_path = safe_path(&state.config.workspace_path, &body.to)?;

    if let Some(parent) = to_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
    }

    tokio::fs::rename(&from_path, &to_path)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    info!("Moved '{}' -> '{}'", body.from, body.to);
    Ok(Json(json!({"from": body.from, "to": body.to})))
}

// ---------------------------------------------------------------------------
// ws_watch: GET /fs/watch?path=... — inotify-based live directory updates
// ---------------------------------------------------------------------------

pub async fn ws_watch(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    AuthUserWs(claims): AuthUserWs,
    Query(params): Query<PathQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "files:read")?;

    let watch_path = safe_path(&state.config.workspace_path, &params.path)?;
    let workspace = state.config.workspace_path.clone();

    Ok(ws.on_upgrade(move |socket| handle_watch_ws(socket, watch_path, workspace)))
}

/// Build a Gitignore matcher by walking the workspace and loading every
/// .gitignore file found (the walk itself respects existing gitignore rules,
/// so ignored directories like node_modules are not descended into).
fn build_gitignore(workspace: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(workspace);
    for result in WalkBuilder::new(workspace).hidden(false).build() {
        let Ok(entry) = result else { continue };
        if entry.file_name() == ".gitignore" {
            builder.add(entry.path());
        }
    }
    builder
        .build()
        .unwrap_or_else(|_| GitignoreBuilder::new(workspace).build().unwrap())
}

fn is_ignored(gitignore: &Gitignore, path: &Path) -> bool {
    let is_dir = path.is_dir();
    gitignore
        .matched_path_or_any_parents(path, is_dir)
        .is_ignore()
}

async fn handle_watch_ws(mut socket: WebSocket, watch_path: PathBuf, workspace: PathBuf) {
    let (tx, mut rx) = mpsc::channel::<Event>(256);

    let mut watcher = match RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = tx.blocking_send(event);
            }
        },
        Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            warn!("Failed to create fs watcher: {}", e);
            return;
        }
    };

    if let Err(e) = watcher.watch(&watch_path, RecursiveMode::Recursive) {
        warn!("Failed to watch path {:?}: {}", watch_path, e);
        return;
    }

    let mut gitignore = build_gitignore(&workspace);
    let gitignore_name = std::ffi::OsStr::new(".gitignore");

    loop {
        tokio::select! {
            event = rx.recv() => {
                let event = match event {
                    Some(e) => e,
                    None => break,
                };

                // Rebuild gitignore rules when any .gitignore file changes.
                if event.paths.iter().any(|p| p.file_name() == Some(gitignore_name)) {
                    gitignore = build_gitignore(&workspace);
                }

                if let Some(msg) = watch_event_to_json(&event, &workspace, &gitignore) {
                    if socket.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
            }
            client_msg = socket.recv() => {
                match client_msg {
                    None | Some(Err(_)) => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}

fn watch_event_to_json(event: &Event, workspace: &Path, gitignore: &Gitignore) -> Option<String> {
    let to_rel = |p: &std::path::Path| -> String {
        let rel = p.strip_prefix(workspace).unwrap_or(p);
        format!("/{}", rel.to_string_lossy())
    };

    let kind = match &event.kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        EventKind::Access(_) | EventKind::Other | EventKind::Any => return None,
    };

    // Drop the event if every affected path is gitignored.
    let visible_path = event.paths.iter().find(|p| !is_ignored(gitignore, p))?;

    Some(json!({"kind": kind, "path": to_rel(visible_path)}).to_string())
}
