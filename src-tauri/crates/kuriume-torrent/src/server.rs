//! Local HTTP streaming server.
//!
//! Serves torrent file data to mpv (or any HTTP client) with full Range
//! request support, enabling seeking during playback while the torrent is
//! still downloading.

use std::io::SeekFrom;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::header::{
    ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
};
use axum::http::{HeaderMap, Response, StatusCode};
use axum::routing::get;
use axum::Router;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use tracing::{debug, error};

use crate::engine::SharedState;
use crate::error::Result;

/// Start the streaming HTTP server on a random available port.
///
/// Returns `(port, join_handle)`.
pub(crate) async fn start(
    state: Arc<SharedState>,
) -> Result<(u16, tokio::task::JoinHandle<()>)> {
    let app = Router::new()
        .route("/stream/{torrent_id}/{file_id}", get(stream_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error!("streaming server error: {e}");
        }
    });

    Ok((port, handle))
}

/// Handle `GET /stream/:torrent_id/:file_id` with optional Range support.
async fn stream_handler(
    Path((torrent_id, file_id)): Path<(usize, usize)>,
    headers: HeaderMap,
    State(state): State<Arc<SharedState>>,
) -> std::result::Result<Response<axum::body::Body>, StatusCode> {
    // Look up the torrent handle
    let handles = state.handles.read().await;
    let torrent = handles
        .get(&torrent_id)
        .ok_or(StatusCode::NOT_FOUND)?
        .clone();
    drop(handles); // release read lock

    // Get content type before consuming the Arc with stream()
    let content_type = guess_content_type_from_torrent(&torrent, file_id);

    // Create a streaming file reader from librqbit (synchronous call)
    // stream() takes Arc<Self> ownership, so we need the clone
    let mut file_stream = torrent
        .stream(file_id)
        .map_err(|e| {
            error!("failed to create file stream: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let total_len = file_stream.len();

    // Check for Range header
    if let Some(range_val) = headers.get(RANGE) {
        let range_str = range_val.to_str().unwrap_or("");
        if let Some((start, end)) = parse_range(range_str, total_len) {
            let len = end - start + 1;

            // Seek to start position
            file_stream
                .seek(SeekFrom::Start(start))
                .await
                .map_err(|e| {
                    error!("seek failed: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            // Limit reads to the requested range
            let limited = file_stream.take(len);
            let reader_stream = ReaderStream::new(limited);
            let body = axum::body::Body::from_stream(reader_stream);

            debug!(torrent_id, file_id, start, end, total_len, "serving range");

            return Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total_len}"))
                .header(CONTENT_LENGTH, len)
                .header(CONTENT_TYPE, content_type)
                .header(ACCEPT_RANGES, "bytes")
                .body(body)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    // No Range — serve the full file
    let reader_stream = ReaderStream::new(file_stream);
    let body = axum::body::Body::from_stream(reader_stream);

    debug!(torrent_id, file_id, total_len, "serving full file");

    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_LENGTH, total_len)
        .header(CONTENT_TYPE, content_type)
        .header(ACCEPT_RANGES, "bytes")
        .body(body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Parse `Range: bytes=start-end` header.
///
/// Returns `Some((start, end))` with `end` inclusive, or `None` on parse failure.
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let range = header.strip_prefix("bytes=")?;

    if let Some(suffix) = range.strip_prefix('-') {
        // `bytes=-500` → last 500 bytes
        let suffix_len: u64 = suffix.parse().ok()?;
        let start = total.saturating_sub(suffix_len);
        return Some((start, total - 1));
    }

    let mut parts = range.splitn(2, '-');
    let start: u64 = parts.next()?.parse().ok()?;

    let end = match parts.next() {
        Some(s) if !s.is_empty() => s.parse::<u64>().ok()?,
        _ => total - 1, // open-ended: `bytes=0-`
    };

    if start > end || start >= total {
        return None;
    }

    Some((start, end.min(total - 1)))
}

/// Guess MIME type from the file extension inside the torrent metadata.
fn guess_content_type_from_torrent(
    torrent: &Arc<librqbit::ManagedTorrent>,
    file_id: usize,
) -> &'static str {
    let ext = torrent
        .with_metadata(|meta| {
            meta.file_infos
                .get(file_id)
                .map(|fi| {
                    fi.relative_filename
                        .to_string_lossy()
                        .rsplit('.')
                        .next()
                        .unwrap_or("")
                        .to_lowercase()
                })
                .unwrap_or_default()
        })
        .unwrap_or_default();

    match ext.as_str() {
        "mkv" => "video/x-matroska",
        "mp4" | "m4v" => "video/mp4",
        "avi" => "video/x-msvideo",
        "webm" => "video/webm",
        "ts" => "video/mp2t",
        "flv" => "video/x-flv",
        "wmv" => "video/x-ms-wmv",
        "mov" => "video/quicktime",
        "ass" | "ssa" => "text/x-ssa",
        "srt" => "text/plain",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_range_full() {
        assert_eq!(parse_range("bytes=0-499", 1000), Some((0, 499)));
    }

    #[test]
    fn test_parse_range_open_end() {
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
    }

    #[test]
    fn test_parse_range_suffix() {
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
    }

    #[test]
    fn test_parse_range_invalid() {
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=500-200", 1000), None);
        assert_eq!(parse_range("invalid", 1000), None);
    }

    #[test]
    fn test_parse_range_clamp() {
        // end > total should be clamped
        assert_eq!(parse_range("bytes=0-9999", 1000), Some((0, 999)));
    }
}
