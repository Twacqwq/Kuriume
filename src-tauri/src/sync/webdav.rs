//! Minimal WebDAV client: exactly the verbs the sync engine needs, with a
//! shared deadline, disabled redirects and no URL text leaking into errors.

use std::time::{Duration, Instant};

use reqwest::header::{HeaderName, CONTENT_TYPE, ETAG, IF_MATCH, IF_NONE_MATCH, LAST_MODIFIED};
use reqwest::{Client, StatusCode, Url};

use super::config::Endpoint;
use super::{Code, Phase, SyncError, CONNECT_TIMEOUT, REQUEST_TIMEOUT};

#[derive(Clone)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

/// One budget shared by every request of a sync run.
#[derive(Clone)]
pub struct Deadline {
    started: Instant,
    budget: Duration,
}

impl Deadline {
    pub fn new(budget: Duration) -> Self {
        Self {
            started: Instant::now(),
            budget,
        }
    }

    pub fn remaining(&self) -> Option<Duration> {
        let left = self.budget.saturating_sub(self.started.elapsed());
        (left > Duration::from_millis(250)).then_some(left)
    }

    pub fn check(&self, phase: Phase) -> Result<(), SyncError> {
        self.remaining()
            .map(|_| ())
            .ok_or_else(|| SyncError::new(Code::Timeout, phase))
    }

    fn request_timeout(&self, phase: Phase) -> Result<Duration, SyncError> {
        let left = self
            .remaining()
            .ok_or_else(|| SyncError::new(Code::Timeout, phase))?;
        Ok(left.min(REQUEST_TIMEOUT))
    }
}

#[derive(Clone, Default, Debug)]
pub struct RemoteMeta {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub length: Option<u64>,
}

#[derive(Debug)]
pub struct RemoteFile {
    pub body: Vec<u8>,
    pub etag: Option<String>,
}

pub enum Precondition {
    None,
    IfMatch(String),
    IfNoneMatch,
}

#[derive(Debug)]
pub struct PutResult {
    pub etag: Option<String>,
}

pub struct WebDav {
    client: Client,
    endpoint: Endpoint,
    credentials: Credentials,
    deadline: Deadline,
}

impl WebDav {
    pub fn new(
        endpoint: Endpoint,
        credentials: Credentials,
        deadline: Deadline,
    ) -> Result<Self, SyncError> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(concat!("kuriume/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| SyncError::new(Code::Internal, Phase::Config))?;
        Ok(Self {
            client,
            endpoint,
            credentials,
            deadline,
        })
    }

    pub fn file_url(&self) -> &Url {
        &self.endpoint.file
    }

    pub fn deadline(&self) -> &Deadline {
        &self.deadline
    }

    fn authorize(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.basic_auth(&self.credentials.username, Some(&self.credentials.password))
    }

    /// Create every missing folder on the way to the file. An existing folder
    /// answers 405, which WebDAV defines as "this collection already exists".
    pub async fn ensure_parents(&self) -> Result<(), SyncError> {
        for parent in &self.endpoint.parents {
            self.mkcol(parent).await?;
        }
        Ok(())
    }

    async fn mkcol(&self, url: &Url) -> Result<(), SyncError> {
        let timeout = self.deadline.request_timeout(Phase::Mkcol)?;
        let request = self.authorize(
            self.client
                .request(mkcol_method(), url.clone())
                .timeout(timeout),
        );
        let response = request
            .send()
            .await
            .map_err(|error| transport(error, Phase::Mkcol))?;
        let status = response.status();
        if status.is_success() || status == StatusCode::METHOD_NOT_ALLOWED {
            return Ok(());
        }
        Err(match map_status(status, Phase::Mkcol) {
            error if error.code == Code::Conflict => {
                SyncError::new(Code::MkcolFailed, Phase::Mkcol)
            }
            error => error,
        })
    }

    pub async fn head(&self) -> Result<Option<RemoteMeta>, SyncError> {
        let timeout = self.deadline.request_timeout(Phase::Head)?;
        let response = self
            .authorize(self.client.head(self.file_url().clone()).timeout(timeout))
            .send()
            .await
            .map_err(|error| transport(error, Phase::Head))?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND || status == StatusCode::GONE {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(map_status(status, Phase::Head));
        }
        Ok(Some(RemoteMeta {
            etag: header_string(&response, ETAG),
            last_modified: header_string(&response, LAST_MODIFIED),
            length: response.content_length(),
        }))
    }

    pub async fn get(&self, limit: u64) -> Result<Option<RemoteFile>, SyncError> {
        let timeout = self.deadline.request_timeout(Phase::Get)?;
        let mut response = self
            .authorize(self.client.get(self.file_url().clone()).timeout(timeout))
            .send()
            .await
            .map_err(|error| transport(error, Phase::Get))?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND || status == StatusCode::GONE {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(map_status(status, Phase::Get));
        }
        if let Some(length) = response.content_length() {
            if length > limit {
                return Err(too_large());
            }
        }
        let etag = header_string(&response, ETAG);
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| transport(error, Phase::Get))?
        {
            if body.len() as u64 + chunk.len() as u64 > limit {
                return Err(too_large());
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Some(RemoteFile { body, etag }))
    }

    pub async fn put(
        &self,
        body: &[u8],
        precondition: &Precondition,
    ) -> Result<PutResult, SyncError> {
        let timeout = self.deadline.request_timeout(Phase::Put)?;
        let mut request = self.authorize(
            self.client
                .put(self.file_url().clone())
                .timeout(timeout)
                .header(CONTENT_TYPE, "application/json")
                .body(body.to_vec()),
        );
        request = match precondition {
            Precondition::IfMatch(etag) => request.header(IF_MATCH, etag.as_str()),
            Precondition::IfNoneMatch => request.header(IF_NONE_MATCH, "*"),
            Precondition::None => request,
        };
        let response = request
            .send()
            .await
            .map_err(|error| transport(error, Phase::Put))?;
        let status = response.status();
        if !status.is_success() {
            return Err(map_status(status, Phase::Put));
        }
        Ok(PutResult {
            etag: header_string(&response, ETAG),
        })
    }

    /// Connectivity and permission check that never touches the file.
    pub async fn probe(&self) -> Result<Option<RemoteMeta>, SyncError> {
        self.ensure_parents().await?;
        self.head().await
    }
}

pub fn is_strong_etag(etag: &str) -> bool {
    let etag = etag.trim();
    etag.len() >= 2 && !etag.starts_with("W/") && !etag.starts_with("w/")
}

fn mkcol_method() -> reqwest::Method {
    reqwest::Method::from_bytes(b"MKCOL").expect("MKCOL is a valid method token")
}

fn header_string(response: &reqwest::Response, name: HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn too_large() -> SyncError {
    SyncError::new(Code::TooLarge, Phase::Parse)
}

/// Status mapping shared by every verb. Bodies are never read into the error.
fn map_status(status: StatusCode, phase: Phase) -> SyncError {
    let code = match status.as_u16() {
        301 | 302 | 303 | 307 | 308 => Code::Redirect,
        401 => Code::Auth,
        403 => Code::Forbidden,
        404 => Code::NotFound,
        409 | 412 => Code::Conflict,
        413 => Code::TooLarge,
        507 => Code::InsufficientStorage,
        405 => Code::MkcolFailed,
        _ if status.is_server_error() => Code::Server,
        _ => Code::Server,
    };
    SyncError::detail(code, phase, format!("HTTP {}", status.as_u16()))
}

fn transport(error: reqwest::Error, phase: Phase) -> SyncError {
    if error.is_timeout() {
        return SyncError::new(Code::Timeout, phase);
    }
    if error.is_redirect() {
        return SyncError::new(Code::Redirect, phase);
    }
    if error.is_connect() {
        let text = format!("{error:?}").to_ascii_lowercase();
        let tls = ["certificate", "tls", "handshake", "ssl"]
            .iter()
            .any(|needle| text.contains(needle));
        return SyncError::new(if tls { Code::Tls } else { Code::Network }, phase);
    }
    SyncError::new(Code::Network, phase)
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
    use httpmock::Method;

    const ETAG: &str = "\"7d8f\"";

    fn webdav_for(server: &MockServer, path: &str) -> WebDav {
        let endpoint = Endpoint {
            file: Url::parse(&format!("{}{path}", server.base_url())).unwrap(),
            parents: Vec::new(),
        };
        WebDav::new(
            endpoint,
            Credentials {
                username: "lei".to_string(),
                password: "secret".to_string(),
            },
            Deadline::new(Duration::from_secs(10)),
        )
        .unwrap()
    }

    #[test]
    fn weak_etags_are_detected() {
        assert!(is_strong_etag("\"abc\""));
        assert!(!is_strong_etag("W/\"abc\""));
        assert!(!is_strong_etag("w/\"abc\""));
        assert!(!is_strong_etag(""));
        assert!(!is_strong_etag("x"));
    }

    #[test]
    fn deadlines_shrink_to_remainder_or_fail() {
        let deadline = Deadline::new(Duration::from_millis(100));
        assert!(deadline.remaining().is_none());
        assert_eq!(deadline.check(Phase::Get).unwrap_err().code, Code::Timeout);
        let healthy = Deadline::new(Duration::from_secs(30));
        let timeout = healthy.request_timeout(Phase::Get).unwrap();
        assert!(timeout <= REQUEST_TIMEOUT);
    }

    #[tokio::test]
    async fn head_reports_missing_and_existing_files() {
        let server = MockServer::start_async().await;
        let missing = server.mock(|when, then| {
            when.method(Method::HEAD).path("/missing.json");
            then.status(404);
        });
        let present = server.mock(|when, then| {
            when.method(Method::HEAD).path("/present.json");
            then.status(200)
                .header("etag", ETAG)
                .header("last-modified", "Mon, 16 Nov 2026 10:00:00 GMT")
                .header("content-length", "128");
        });

        let absent = webdav_for(&server, "/missing.json").head().await.unwrap();
        assert!(absent.is_none());
        let meta = webdav_for(&server, "/present.json")
            .head()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(meta.etag.as_deref(), Some(ETAG));
        assert_eq!(
            meta.last_modified.as_deref(),
            Some("Mon, 16 Nov 2026 10:00:00 GMT")
        );
        // httpmock rewrites content-length on HEAD to 0, so only presence is
        // checked here; the value is read straight from the header.
        assert!(meta.length.is_some());
        missing.assert_async().await;
        present.assert_async().await;
    }

    #[tokio::test]
    async fn get_returns_the_body_and_rejects_oversized_files() {
        let server = MockServer::start_async().await;
        let small = server.mock(|when, then| {
            when.method(GET).path("/small.json");
            then.status(200).header("etag", ETAG).body("{\"a\":1}");
        });
        let huge = server.mock(|when, then| {
            when.method(GET).path("/huge.json");
            then.status(200).body("0123456789");
        });

        let file = webdav_for(&server, "/small.json")
            .get(1024)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(file.body, b"{\"a\":1}");
        assert_eq!(file.etag.as_deref(), Some(ETAG));
        assert_eq!(
            webdav_for(&server, "/huge.json")
                .get(4)
                .await
                .unwrap_err()
                .code,
            Code::TooLarge
        );
        small.assert_async().await;
        huge.assert_async().await;
    }

    #[tokio::test]
    async fn put_sends_the_conditional_headers() {
        let server = MockServer::start_async().await;
        let created = server.mock(|when, then| {
            when.method(PUT)
                .path("/fresh.json")
                .header("if-none-match", "*");
            then.status(201).header("etag", "\"1\"");
        });
        let replaced = server.mock(|when, then| {
            when.method(PUT)
                .path("/replace.json")
                .header("if-match", "\"2\"");
            then.status(204).header("etag", "\"3\"");
        });
        let conflict = server.mock(|when, then| {
            when.method(PUT).path("/stale.json");
            then.status(412);
        });

        let first = webdav_for(&server, "/fresh.json")
            .put(b"{}", &Precondition::IfNoneMatch)
            .await
            .unwrap();
        assert_eq!(first.etag.as_deref(), Some("\"1\""));
        let second = webdav_for(&server, "/replace.json")
            .put(b"{}", &Precondition::IfMatch("\"2\"".to_string()))
            .await
            .unwrap();
        assert_eq!(second.etag.as_deref(), Some("\"3\""));
        assert_eq!(
            webdav_for(&server, "/stale.json")
                .put(b"{}", &Precondition::None)
                .await
                .unwrap_err()
                .code,
            Code::Conflict
        );
        created.assert_async().await;
        replaced.assert_async().await;
        conflict.assert_async().await;
    }

    #[tokio::test]
    async fn status_codes_map_to_stable_codes() {
        let server = MockServer::start_async().await;
        let unauthorized = server.mock(|when, then| {
            when.method(Method::HEAD).path("/auth.json");
            then.status(401);
        });
        let redirected = server.mock(|when, then| {
            when.method(Method::HEAD).path("/moved.json");
            then.status(302)
                .header("location", "https://elsewhere.example/file");
        });
        let full = server.mock(|when, then| {
            when.method(PUT).path("/full.json");
            then.status(507);
        });
        let unavailable = server.mock(|when, then| {
            when.method(GET).path("/down.json");
            then.status(503);
        });

        assert_eq!(
            webdav_for(&server, "/auth.json")
                .head()
                .await
                .unwrap_err()
                .code,
            Code::Auth
        );
        assert_eq!(
            webdav_for(&server, "/moved.json")
                .head()
                .await
                .unwrap_err()
                .code,
            Code::Redirect
        );
        assert_eq!(
            webdav_for(&server, "/full.json")
                .put(b"{}", &Precondition::None)
                .await
                .unwrap_err()
                .code,
            Code::InsufficientStorage
        );
        assert_eq!(
            webdav_for(&server, "/down.json")
                .get(1024)
                .await
                .unwrap_err()
                .code,
            Code::Server
        );
        unauthorized.assert_async().await;
        redirected.assert_async().await;
        full.assert_async().await;
        unavailable.assert_async().await;
    }

    #[tokio::test]
    async fn mkcol_accepts_created_and_existing_folders() {
        let server = MockServer::start_async().await;
        // httpmock 0.7 only knows the standard methods, so these mocks match by
        // path alone; any request to the folder therefore answers like MKCOL did.
        let created = server.mock(|when, then| {
            when.path("/dav/new/");
            then.status(201);
        });
        let existing = server.mock(|when, then| {
            when.path("/dav/old/");
            then.status(405);
        });

        let endpoint = Endpoint {
            file: Url::parse(&format!("{}/dav/new/records.json", server.base_url())).unwrap(),
            parents: vec![Url::parse(&format!("{}/dav/new/", server.base_url())).unwrap()],
        };
        let client = WebDav::new(
            endpoint,
            Credentials {
                username: "lei".to_string(),
                password: "secret".to_string(),
            },
            Deadline::new(Duration::from_secs(10)),
        )
        .unwrap();
        client.ensure_parents().await.unwrap();
        created.assert_async().await;

        let existing_endpoint = Endpoint {
            file: Url::parse(&format!("{}/dav/old/records.json", server.base_url())).unwrap(),
            parents: vec![Url::parse(&format!("{}/dav/old/", server.base_url())).unwrap()],
        };
        let other = WebDav::new(
            existing_endpoint,
            Credentials {
                username: "lei".to_string(),
                password: "secret".to_string(),
            },
            Deadline::new(Duration::from_secs(10)),
        )
        .unwrap();
        other.ensure_parents().await.unwrap();
        existing.assert_async().await;
    }

    #[tokio::test]
    async fn refused_connections_map_to_network() {
        let client = WebDav::new(
            Endpoint {
                file: Url::parse("http://127.0.0.1:1/records.json").unwrap(),
                parents: Vec::new(),
            },
            Credentials {
                username: "lei".to_string(),
                password: "secret".to_string(),
            },
            Deadline::new(Duration::from_secs(5)),
        )
        .unwrap();
        let code = client.head().await.unwrap_err().code;
        assert!(matches!(code, Code::Network | Code::Timeout | Code::Tls));
    }
}
