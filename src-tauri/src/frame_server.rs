//! WebSocket server that broadcasts raw video frames to connected clients.
//!
//! Protocol (binary messages, little-endian):
//! - Bytes  0..4  — width  (u32 LE)
//! - Bytes  4..8  — height (u32 LE)
//! - Bytes  8..   — RGBA pixel data (width × height × 4 bytes)

use futures_util::{SinkExt, StreamExt};
use kuriume_mpv::OffscreenRenderer;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;

/// A running frame server.
pub struct FrameServer {
    /// The port the WebSocket server is listening on.
    pub port: u16,
    /// Handle to cancel the server.
    cancel: tokio::sync::watch::Sender<bool>,
    /// Join handles for spawned tasks.
    accept_handle: Option<tokio::task::JoinHandle<()>>,
    broadcast_handle: Option<tokio::task::JoinHandle<()>>,
}

impl FrameServer {
    /// Start the frame server on a random localhost port.
    ///
    /// `renderer` is polled for new frames whenever `frame_notify` fires.
    pub async fn start(
        renderer: Arc<OffscreenRenderer>,
        frame_notify: Arc<Notify>,
    ) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("bind failed: {e}"))?;

        let port = listener
            .local_addr()
            .map_err(|e| format!("local_addr failed: {e}"))?
            .port();

        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

        // Shared list of connected WebSocket senders.
        let clients: Arc<tokio::sync::Mutex<Vec<ClientSender>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));

        // Task: accept new connections.
        let clients_accept = clients.clone();
        let mut cancel_accept = cancel_rx.clone();
        let accept_handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        let (stream, _) = match result {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let ws = match tokio_tungstenite::accept_async(stream).await {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let (sink, mut stream) = ws.split();
                        clients_accept.lock().await.push(ClientSender(sink));

                        // Spawn a drain task for the read half so the WS doesn't stall.
                        tokio::spawn(async move {
                            while stream.next().await.is_some() {}
                        });
                    }
                    _ = cancel_accept.changed() => break,
                }
            }
        });

        // Task: broadcast frames to all clients.
        let clients_broadcast = clients.clone();
        let mut cancel_broadcast = cancel_rx;
        let broadcast_handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = frame_notify.notified() => {}
                    _ = cancel_broadcast.changed() => break,
                }

                let frame = renderer.take_frame();
                let Some(frame) = frame else { continue };

                // Build the binary message: [width LE][height LE][RGBA data]
                let header_len = 8;
                let mut payload = Vec::with_capacity(header_len + frame.data.len());
                payload.extend_from_slice(&frame.width.to_le_bytes());
                payload.extend_from_slice(&frame.height.to_le_bytes());
                payload.extend_from_slice(&frame.data);

                let msg = Message::Binary(payload.into());

                let mut senders = clients_broadcast.lock().await;
                let mut alive = Vec::with_capacity(senders.len());
                for mut client in senders.drain(..) {
                    if client.0.send(msg.clone()).await.is_ok() {
                        alive.push(client);
                    }
                }
                *senders = alive;
            }
        });

        Ok(Self {
            port,
            cancel: cancel_tx,
            accept_handle: Some(accept_handle),
            broadcast_handle: Some(broadcast_handle),
        })
    }

    /// Stop the frame server and wait for tasks to finish.
    ///
    /// This ensures all `Arc` clones held by spawned tasks are dropped.
    pub async fn shutdown(mut self) {
        let _ = self.cancel.send(true);
        if let Some(h) = self.accept_handle.take() {
            let _ = h.await;
        }
        if let Some(h) = self.broadcast_handle.take() {
            let _ = h.await;
        }
    }
}

impl Drop for FrameServer {
    fn drop(&mut self) {
        let _ = self.cancel.send(true);
        // Abort tasks so captured `Arc`s are released promptly.
        if let Some(h) = self.accept_handle.take() {
            h.abort();
        }
        if let Some(h) = self.broadcast_handle.take() {
            h.abort();
        }
    }
}

/// Wrapper to make the WS sink type less verbose.
struct ClientSender(
    futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
        Message,
    >,
);
