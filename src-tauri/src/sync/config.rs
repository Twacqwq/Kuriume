//! Address handling for the WebDAV endpoint. Everything here is pure so the
//! same rules apply to saving the form and to building requests.

use reqwest::Url;
use ring::digest;

use super::{Code, Phase, SyncError};

fn config_error(code: Code) -> SyncError {
    SyncError::new(code, Phase::Config)
}

/// Parse the stored server address and enforce the transport rules.
pub fn parse_base(server_url: &str) -> Result<Url, SyncError> {
    let url = Url::parse(server_url.trim()).map_err(|_| config_error(Code::InvalidUrl))?;
    if url.scheme() != "https" {
        return Err(config_error(Code::NotHttps));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(config_error(Code::InvalidUrl));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(config_error(Code::InvalidUrl));
    }
    Ok(url)
}

/// Canonical form: origin plus the path prefix, without a trailing slash.
pub fn normalize_server_url(server_url: &str) -> Result<String, SyncError> {
    let url = parse_base(server_url)?;
    let origin = url.origin().ascii_serialization();
    let path = url.path().trim_end_matches('/');
    Ok(format!("{origin}{path}"))
}

pub fn validate_remote_path(remote_path: &str) -> Result<(), SyncError> {
    let invalid = || config_error(Code::InvalidPath);
    if !remote_path.starts_with('/') || remote_path.starts_with("//") {
        return Err(invalid());
    }
    if remote_path.ends_with('/') {
        return Err(invalid());
    }
    if remote_path.chars().count() > 2048 {
        return Err(invalid());
    }
    if remote_path
        .chars()
        .any(|value| matches!(value, '\\' | '%' | '?' | '#') || value.is_control())
    {
        return Err(invalid());
    }
    let segments: Vec<&str> = remote_path.split('/').skip(1).collect();
    if segments.is_empty()
        || segments
            .iter()
            .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
    {
        return Err(invalid());
    }
    Ok(())
}

pub struct Endpoint {
    pub file: Url,
    /// Collections from the top of the server path down to the file's folder.
    pub parents: Vec<Url>,
}

impl Endpoint {}

fn build(
    base: &Url,
    segments: &[String],
    depth: usize,
    collection: bool,
) -> Result<Url, SyncError> {
    let mut url = base.clone();
    url.set_query(None);
    url.set_fragment(None);
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| config_error(Code::InvalidUrl))?;
        path.pop_if_empty();
        for segment in segments.iter().take(depth) {
            path.push(segment);
        }
        if collection {
            path.push("");
        }
    }
    if url.scheme() != base.scheme()
        || url.host_str() != base.host_str()
        || url.port_or_known_default() != base.port_or_known_default()
    {
        return Err(config_error(Code::InvalidUrl));
    }
    Ok(url)
}

/// Join the server path prefix with the remote path and derive the folders that
/// must exist before the file can be written.
pub fn endpoint(server_url: &str, remote_path: &str) -> Result<Endpoint, SyncError> {
    validate_remote_path(remote_path)?;
    let base = parse_base(server_url)?;
    let segments: Vec<String> = remote_path.split('/').skip(1).map(str::to_string).collect();
    let file = build(&base, &segments, segments.len(), false)?;
    let mut parents = Vec::new();
    for depth in 1..segments.len() {
        parents.push(build(&base, &segments, depth, true)?);
    }
    Ok(Endpoint { file, parents })
}

/// The credential store account: origin and username together, so changing
/// either one asks for the password again instead of reusing the old secret.
/// The origin is hashed because the Android preferences file cannot store keys
/// containing control characters.
pub fn credential_key(server_url: &str, username: &str) -> Result<String, SyncError> {
    let base = parse_base(server_url)?;
    let identity = format!(
        "{}\u{0}{}",
        base.origin().ascii_serialization(),
        username.trim()
    );
    let digest = digest::digest(&digest::SHA256, identity.as_bytes());
    let mut account = String::with_capacity(64);
    for byte in digest.as_ref() {
        use std::fmt::Write;
        let _ = write!(account, "{byte:02x}");
    }
    Ok(account)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_urls_are_normalized_or_rejected() {
        assert_eq!(
            normalize_server_url("https://dav.example.com/dav/").unwrap(),
            "https://dav.example.com/dav"
        );
        assert_eq!(
            normalize_server_url("https://dav.example.com").unwrap(),
            "https://dav.example.com"
        );
        assert_eq!(
            normalize_server_url("https://dav.example.com:8443/dav//").unwrap(),
            "https://dav.example.com:8443/dav"
        );
        for bad in [
            "http://dav.example.com",
            "https://user:secret@dav.example.com/dav",
            "https://dav.example.com/dav?x=1",
            "https://dav.example.com/dav#top",
            "dav.example.com",
            "",
        ] {
            assert!(normalize_server_url(bad).is_err(), "{bad} must be rejected");
        }
        assert_eq!(
            normalize_server_url("http://dav.example.com")
                .unwrap_err()
                .code,
            Code::NotHttps
        );
    }

    #[test]
    fn remote_paths_reject_traversal_and_encoding() {
        for good in ["/kuriume/records.json", "/a.json", "/a-b_c/d.json"] {
            validate_remote_path(good).unwrap();
        }
        for bad in [
            "kuriume/records.json",
            "//kuriume/records.json",
            "/kuriume//records.json",
            "/kuriume/../records.json",
            "/kuriume/./records.json",
            "/kuriume/records.json/",
            "/kuriume\\records.json",
            "/kuriume/%2e%2e/records.json",
            "/kuriume/records.json?x=1",
            "",
        ] {
            assert!(validate_remote_path(bad).is_err(), "{bad} must be rejected");
        }
        assert_eq!(
            validate_remote_path("/a//b").unwrap_err().code,
            Code::InvalidPath
        );
    }

    #[test]
    fn endpoints_keep_the_server_prefix_and_derive_parent_folders() {
        let first = endpoint("https://dav.example.com/dav/", "/kuriume/my records.json").unwrap();
        assert_eq!(
            first.file.as_str(),
            "https://dav.example.com/dav/kuriume/my%20records.json"
        );
        let parents: Vec<String> = first
            .parents
            .iter()
            .map(|url| url.as_str().to_string())
            .collect();
        assert_eq!(
            parents,
            vec!["https://dav.example.com/dav/kuriume/".to_string()]
        );
        assert!(first.file.as_str().starts_with("https://dav.example.com/"));

        let flat = endpoint("https://dav.example.com/dav", "/a.json").unwrap();
        assert_eq!(flat.file.as_str(), "https://dav.example.com/dav/a.json");
        assert!(flat.parents.is_empty());

        let nested = endpoint("https://dav.example.com", "/a/b/d.json").unwrap();
        let parents: Vec<String> = nested
            .parents
            .iter()
            .map(|url| url.as_str().to_string())
            .collect();
        assert_eq!(
            parents,
            vec![
                "https://dav.example.com/a/".to_string(),
                "https://dav.example.com/a/b/".to_string()
            ]
        );
        assert_eq!(nested.file.as_str(), "https://dav.example.com/a/b/d.json");
    }

    #[test]
    fn credential_keys_bind_the_origin_and_the_username() {
        let key = credential_key("https://dav.example.com/dav", "lei").unwrap();
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            key,
            credential_key("https://dav.example.com/other", "lei").unwrap()
        );
        assert_ne!(
            key,
            credential_key("https://other.example.com/dav", "lei").unwrap()
        );
        assert_ne!(
            key,
            credential_key("https://dav.example.com/dav", "other").unwrap()
        );
        assert_eq!(
            credential_key("https://user@dav.example.com", "lei")
                .unwrap_err()
                .code,
            Code::InvalidUrl
        );
    }
}
