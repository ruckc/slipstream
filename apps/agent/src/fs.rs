use crate::{
    auth::{require_permission, AuthUser},
    error::AppError,
    AppState,
};
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::io::AsyncReadExt;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{debug, info};

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

fn safe_path(workspace: &Path, user_path: &str) -> Result<PathBuf, AppError> {
    let trimmed = user_path.trim_start_matches('/');
    let joined = workspace.join(trimmed);

    // Canonicalize to resolve symlinks/.. — but only if the path exists.
    let canonical = joined.canonicalize().unwrap_or_else(|_| joined.clone());

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
// upload_file: POST /fs/upload?path=/some/file
// Supports Content-Range: bytes START-END/TOTAL
// ---------------------------------------------------------------------------

pub async fn upload_file(
    State(state): State<Arc<AppState>>,
    AuthUser(claims): AuthUser,
    Query(params): Query<PathQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&claims, "files:write")?;
    state.idle.touch();

    let file_path = safe_path(&state.config.workspace_path, &params.path)?;

    // Ensure parent directory exists.
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
    }

    // Parse Content-Range header: `bytes START-END/TOTAL`
    let content_range = headers
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(range_str) = content_range {
        // Parse "bytes START-END/TOTAL"
        if let Some(rest) = range_str.strip_prefix("bytes ") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            if parts.len() == 2 {
                let range_parts: Vec<&str> = parts[0].splitn(2, '-').collect();
                let total: u64 = parts[1].parse().unwrap_or(0);

                if range_parts.len() == 2 {
                    let start: u64 = range_parts[0].parse().unwrap_or(0);
                    let end: u64 = range_parts[1].parse().unwrap_or(0);

                    // Write chunk at the correct offset.
                    use tokio::io::{AsyncSeekExt, AsyncWriteExt};

                    let mut file = if start == 0 {
                        // First chunk — create/truncate the file.
                        tokio::fs::OpenOptions::new()
                            .create(true)
                            .write(true)
                            .truncate(true)
                            .open(&file_path)
                            .await
                            .map_err(|e| AppError::Internal(e.into()))?
                    } else {
                        // Subsequent chunk — open for writing, keep existing data.
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

                    file.write_all(&body)
                        .await
                        .map_err(|e| AppError::Internal(e.into()))?;

                    let received = end + 1;
                    let complete = received >= total;

                    info!(
                        "Upload chunk {}-{}/{} for '{}', complete={}",
                        start, end, total, params.path, complete
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

    // No Content-Range → write entire file.
    tokio::fs::write(&file_path, &body)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let received = body.len() as u64;
    info!("Uploaded '{}' ({} bytes)", params.path, received);

    Ok((
        StatusCode::OK,
        Json(json!({"received": received, "complete": true})),
    )
        .into_response())
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
