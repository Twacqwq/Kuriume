//! Apple media transport. Only opaque registered sessions are reachable; this is
//! not a URL-forwarding endpoint. All upstream scope/range/cookie checks stay in
//! the shared media handler.
use super::{error_response, MediaProxyState};
use http_body_util::Full;
use hyper::{body::Bytes, server::conn::http1, service::service_fn};
use hyper_util::rt::TokioIo;
use std::{convert::Infallible, net::SocketAddr, sync::Arc, time::Duration};
use tauri::http::{Request, StatusCode};
use tokio::sync::{oneshot, Semaphore};

pub(super) struct Server {
    address: SocketAddr,
    // Dropping the media state closes the listener, including in tests.
    _shutdown: oneshot::Sender<()>,
}

impl MediaProxyState {
    #[cfg(debug_assertions)]
    pub(crate) fn set_dev_origin(&self, url: Option<&reqwest::Url>) {
        if let Ok(mut origin) = self.inner.dev_origin.lock() {
            // Tauri uses the host's LAN address for real-device development.
            // Trust exactly that configured origin, never arbitrary LAN callers.
            *origin = url
                .filter(|url| matches!(url.scheme(), "http" | "https"))
                .map(|url| url.origin().ascii_serialization());
        }
    }

    pub(super) fn loopback_address(&self) -> Result<SocketAddr, String> {
        let mut server = self
            .inner
            .loopback
            .lock()
            .map_err(|_| "Media transport unavailable")?;
        if let Some(server) = server.as_ref() {
            return Ok(server.address);
        }
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Unable to start local media transport")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Unable to configure media transport")?;
        let address = listener
            .local_addr()
            .map_err(|_| "Media address unavailable")?;
        let (shutdown, mut closed) = oneshot::channel();
        let weak = Arc::downgrade(&self.inner);
        tauri::async_runtime::spawn(async move {
            let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
                return;
            };
            let connections = Arc::new(Semaphore::new(16));
            loop {
                let accepted = tokio::select! {
                    _ = &mut closed => break,
                    accepted = listener.accept() => accepted,
                };
                let Ok((stream, _)) = accepted else { break };
                let Ok(permit) = connections.clone().try_acquire_owned() else {
                    continue;
                };
                let weak = weak.clone();
                tauri::async_runtime::spawn(async move {
                    let _permit = permit;
                    let service = service_fn(move |request: Request<hyper::body::Incoming>| {
                        let inner = weak.upgrade();
                        async move {
                            let dev_origin = inner
                                .as_ref()
                                .and_then(|inner| inner.dev_origin.lock().ok()?.clone());
                            let response =
                                if !valid_request(&request, address, dev_origin.as_deref()) {
                                    error_response(StatusCode::FORBIDDEN, "Invalid media request")
                                } else if let Some(inner) = inner {
                                    MediaProxyState { inner }
                                        .response(request.map(|_| Vec::new()))
                                        .await
                                } else {
                                    error_response(StatusCode::GONE, "Media transport closed")
                                };
                            Ok::<_, Infallible>(response.map(|body| Full::new(Bytes::from(body))))
                        }
                    });
                    // Bound idle connections and request/header memory as well
                    // as the existing per-response 4 MiB media limit.
                    let _ = tokio::time::timeout(
                        Duration::from_secs(60),
                        http1::Builder::new()
                            .max_buf_size(16 * 1024)
                            .serve_connection(TokioIo::new(stream), service),
                    )
                    .await;
                });
            }
        });
        *server = Some(Server {
            address,
            _shutdown: shutdown,
        });
        Ok(address)
    }
}

fn valid_request<B>(request: &Request<B>, address: SocketAddr, dev_origin: Option<&str>) -> bool {
    // Exact Host prevents DNS-rebinding; a guessed path cannot create a session.
    request.headers().get("host").and_then(|v| v.to_str().ok())
        == Some(address.to_string().as_str())
        && request.uri().scheme().is_none()
        && request.uri().authority().is_none()
        && request.uri().query().is_none()
        && !request.headers().contains_key("transfer-encoding")
        && request
            .headers()
            .get("content-length")
            .is_none_or(|v| v == "0")
        && request.headers().get("origin").is_none_or(|origin| {
            let origin = origin.to_str().unwrap_or("");
            dev_origin == Some(origin)
                || matches!(
                    origin,
                    "tauri://localhost"
                        | "http://tauri.localhost"
                        | "http://localhost:1420"
                        | "null"
                )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use kuriume_provider::PlaybackHeaders;

    #[test]
    fn mobile_dev_trusts_only_the_configured_origin() {
        let address = "127.0.0.1:4567".parse().unwrap();
        let request = Request::builder()
            .uri("/session")
            .header("host", "127.0.0.1:4567")
            .header("origin", "http://192.168.1.4:1420")
            .body(())
            .unwrap();
        assert!(!valid_request(&request, address, None));
        assert!(valid_request(
            &request,
            address,
            Some("http://192.168.1.4:1420")
        ));
        assert!(!valid_request(
            &request,
            address,
            Some("http://192.168.1.5:1420")
        ));
    }

    #[tokio::test]
    async fn mp4_uses_loopback_with_scoped_sessions_and_listener_lifetime() {
        let proxy = MediaProxyState::new();
        let url = proxy
            .register(
                "https://media.example/video.mp4?secret=test",
                PlaybackHeaders::new(),
                &["media.example".into()],
                Some("video/mp4"),
            )
            .unwrap();
        let parsed: reqwest::Url = url.parse().unwrap();
        assert_eq!(parsed.host_str(), Some("127.0.0.1"));
        assert_eq!(parsed.path().len(), 33);
        assert!(!url.contains("secret"));
        let address = proxy.loopback_address().unwrap();
        let client = reqwest::Client::new();
        assert_eq!(
            client.post(&url).send().await.unwrap().status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert_eq!(
            client
                .get(format!("http://{address}/unknown"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        for (header, value) in [
            ("Host", "evil.example"),
            ("Origin", "https://evil.example"),
            ("Content-Length", "1"),
        ] {
            assert_eq!(
                client
                    .get(&url)
                    .header(header, value)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::FORBIDDEN
            );
        }
        let hls = proxy
            .register(
                "https://media.example/index.m3u8",
                PlaybackHeaders::new(),
                &["media.example".into()],
                Some("application/vnd.apple.mpegurl"),
            )
            .unwrap();
        #[cfg(target_os = "macos")]
        assert!(hls.starts_with("kuriume-media:"));
        #[cfg(target_os = "ios")]
        assert!(hls.starts_with("http://127.0.0.1:"));
        drop(proxy);
        // Listener shutdown is asynchronous, but must not keep the state alive.
        tokio::time::timeout(Duration::from_secs(1), async {
            while tokio::net::TcpStream::connect(address).await.is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}
