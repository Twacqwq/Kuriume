//! Process-local diagnostics. Error messages are bounded and redacted before storage.
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const MAX_BYTES: usize = 1024 * 1024;
const MAX_ENTRIES: usize = 1_000;
const MAX_ENTRY_BYTES: usize = 4_096;
const PAGE_SIZE: usize = 50;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    AppStarted,
    UiError,
    CatalogRequest,
    SourceSearch,
    SourceEpisodes,
    SourceResolve,
    SourcePrepare,
    MediaRequest,
    PlayerLoad,
    PlayerPlaying,
    PlayerPlay,
    PlayerPause,
    PlayerBackground,
    PlayerBuffering,
    PlayerSeek,
    PlayerError,
    SubtitleError,
    NativeControl,
    PlayerFallback,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    Start,
    Ok,
    Empty,
    Cancelled,
    Timeout,
    Connect,
    Http,
    Decode,
    Parse,
    NotFound,
    Source,
    Network,
    Unsupported,
    Aborted,
    Unknown,
    TypeError,
    RangeError,
    ReferenceError,
    SyntaxError,
    UnhandledRejection,
    HlsManifest,
    HlsFragment,
    HlsBuffer,
    HlsKey,
    Subtitle,
    Native,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Anilist,
    Bangumi,
    Anime1,
    Xifan,
    Agedm,
    Hianime,
    Imported,
}

pub fn provider(id: &str) -> Provider {
    match id {
        "AniList" | "anilist" => Provider::Anilist,
        "Bangumi" | "bangumi" => Provider::Bangumi,
        "builtin:anime1" => Provider::Anime1,
        "builtin:xifan" => Provider::Xifan,
        "builtin:age" => Provider::Agedm,
        "builtin:hianime" => Provider::Hianime,
        _ => Provider::Imported,
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    Hlsjs,
    NativeHls,
    HtmlVideo,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    List,
    Search,
    Detail,
    Episodes,
    Calendar,
    Characters,
    Relations,
    Direct,
    Sniff,
    Fetch,
    Read,
    Redirect,
    Playlist,
    Prepare,
    Pause,
    Levels,
    Volume,
    Brightness,
    Finish,
    Fullscreen,
    Leave,
}

// Keep context typed; only error text passes through the bounded redactor.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Details {
    pub operation: Option<u64>,
    pub provider: Option<Provider>,
    pub code: Option<Code>,
    pub action: Option<Action>,
    pub message: Option<String>,
    pub elapsed_ms: Option<u64>,
    pub status: Option<u16>,
    pub count: Option<u32>,
    pub attempt: Option<u32>,
    pub engine: Option<Engine>,
    pub position: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub dropped_frames: Option<u32>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub webview_major: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub event: Event,
    pub level: Level,
    pub details: Details,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: u64,
    at: u64,
    last_at: u64,
    repeats: u32,
    #[serde(flatten)]
    input: Input,
}

#[derive(Default)]
struct Buffer {
    entries: VecDeque<(Entry, usize)>,
    bytes: usize,
    next_id: u64,
    evicted: u64,
}

impl Buffer {
    fn push(&mut self, mut input: Input, now: u64) {
        input.details.message = input.details.message.as_deref().map(sanitize_message);
        if let Some((last, size)) = self.entries.back_mut() {
            if last.input == input && now.saturating_sub(last.last_at) <= 2_000 {
                last.repeats = last.repeats.saturating_add(1);
                last.last_at = now;
                let updated = serde_json::to_vec(last).map_or(*size, |s| s.len());
                self.bytes = self.bytes - *size + updated;
                *size = updated;
                self.trim();
                return;
            }
        }
        self.next_id = self.next_id.saturating_add(1);
        let entry = Entry {
            id: self.next_id,
            at: now,
            last_at: now,
            repeats: 1,
            input,
        };
        let Ok(encoded) = serde_json::to_vec(&entry) else {
            return;
        };
        if encoded.len() > MAX_ENTRY_BYTES {
            return;
        }
        self.bytes += encoded.len();
        self.entries.push_back((entry, encoded.len()));
        self.trim();
    }

    fn trim(&mut self) {
        while self.bytes > MAX_BYTES || self.entries.len() > MAX_ENTRIES {
            if let Some((_, size)) = self.entries.pop_front() {
                self.bytes -= size;
                self.evicted = self.evicted.saturating_add(1);
            }
        }
    }

    fn page(&self, before: Option<u64>, errors_only: bool) -> Page {
        let mut matching = self.entries.iter().rev().filter(|(entry, _)| {
            before.is_none_or(|id| entry.id < id)
                && (!errors_only || entry.input.level != Level::Info)
        });
        let entries = matching
            .by_ref()
            .take(PAGE_SIZE)
            .map(|(entry, _)| entry.clone())
            .collect();
        Page {
            entries,
            has_more: matching.next().is_some(),
            bytes: self.bytes,
            max_bytes: MAX_BYTES,
            total: self.entries.len(),
            evicted: self.evicted,
            version: env!("CARGO_PKG_VERSION"),
            platform: std::env::consts::OS,
        }
    }

    fn clear(&mut self) {
        // Keep IDs monotonic, so old pagination cursors never overlap new logs.
        self.entries = VecDeque::new();
        self.bytes = 0;
        self.evicted = 0;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    entries: Vec<Entry>,
    has_more: bool,
    bytes: usize,
    max_bytes: usize,
    total: usize,
    evicted: u64,
    version: &'static str,
    platform: &'static str,
}

fn buffer() -> &'static Mutex<Buffer> {
    static BUFFER: OnceLock<Mutex<Buffer>> = OnceLock::new();
    BUFFER.get_or_init(Mutex::default)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn record(event: Event, level: Level, details: Details) {
    // Diagnostics must never wait on the playback path or panic on poisoning.
    if let Ok(mut buffer) = buffer().try_lock() {
        buffer.push(
            Input {
                event,
                level,
                details,
            },
            now_ms(),
        );
    }
}

pub fn operation() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

pub fn http_code(error: &reqwest::Error) -> Code {
    if error.is_timeout() {
        Code::Timeout
    } else if error.is_connect() {
        Code::Connect
    } else if error.is_status() {
        Code::Http
    } else if error.is_decode() {
        Code::Decode
    } else {
        Code::Network
    }
}

/// Error text only, never request/response payloads. URLs (including their path
/// and query), credentials, local paths and opaque tokens must not reach memory.
pub fn sanitize_message(message: &str) -> String {
    static RULES: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let rules = RULES.get_or_init(|| [
        r#"(?i)(?:authorization|proxy-authorization|set-cookie|cookie|[a-z_]*(?:token|password|secret)|api[-_]?key)\s*[\"']?\s*[:=][^\r\n]*"#,
        r"(?i)\b(?:bearer|basic)\s+[^\s,;]+",
        r#"(?i)(?:[a-z][a-z0-9+.-]*://|www\.)[^\s<>\"']+"#,
        r#"(?:[A-Za-z]:\\|/)[^\s<>\"']+"#,
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        r"[A-Za-z0-9_+=.-]{40,}",
    ].into_iter().map(|pattern| regex::Regex::new(pattern).expect("static redaction pattern")).collect());
    let mut text: String = message.chars().take(2048).collect();
    for rule in rules {
        text = rule.replace_all(&text, "[redacted]").into_owned();
    }
    text = text
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut end = text.len().min(1024);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

pub fn error_message(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![sanitize_message(&error.to_string())];
    let mut source = error.source();
    for _ in 0..3 {
        let Some(cause) = source else { break };
        let message = sanitize_message(&cause.to_string());
        if !parts.iter().any(|part| part.contains(&message)) {
            parts.push(message);
        }
        source = cause.source();
    }
    sanitize_message(&parts.join("; caused by: "))
}

/// Preserve caller behavior, but retain a safe, useful error chain for diagnosis.
pub async fn observe<T>(
    event: Event,
    provider_id: &str,
    operation: u64,
    action: Option<Action>,
    future: impl std::future::Future<Output = kuriume_provider::Result<T>>,
) -> kuriume_provider::Result<T> {
    let provider = provider(provider_id);
    record(
        event,
        Level::Info,
        Details {
            operation: Some(operation),
            provider: Some(provider),
            code: Some(Code::Start),
            action,
            ..Details::default()
        },
    );
    let started = Instant::now();
    let result = future.await;
    use kuriume_provider::ProviderError;
    let (code, status) = match &result {
        Ok(_) => (Code::Ok, None),
        Err(ProviderError::Http(e)) => (http_code(e), e.status().map(|s| s.as_u16())),
        Err(ProviderError::Json(_) | ProviderError::Parse(_)) => (Code::Parse, None),
        Err(ProviderError::NotFound(_)) => (Code::NotFound, None),
        Err(ProviderError::Network(_)) => (Code::Network, None),
        Err(ProviderError::Source(_)) => (Code::Source, None),
    };
    record(
        event,
        if result.is_ok() {
            Level::Info
        } else {
            Level::Error
        },
        Details {
            operation: Some(operation),
            provider: Some(provider),
            code: Some(code),
            status,
            action,
            message: result.as_ref().err().map(|error| error_message(error)),
            elapsed_ms: Some(started.elapsed().as_millis() as u64),
            ..Details::default()
        },
    );
    result
}

fn require_main(label: &str) -> Result<(), &'static str> {
    if label == "main" {
        Ok(())
    } else {
        Err("Diagnostics are limited to the main view")
    }
}

#[tauri::command]
pub fn diagnostics_write(webview: tauri::Webview, entries: Vec<Input>) -> Result<(), &'static str> {
    require_main(webview.label())?;
    if entries.len() > 8 {
        return Err("Diagnostic batch too large");
    }
    for entry in entries {
        record(entry.event, entry.level, entry.details);
    }
    Ok(())
}

#[tauri::command]
pub fn diagnostics_read(
    webview: tauri::Webview,
    before: Option<u64>,
    errors_only: bool,
) -> Result<Page, &'static str> {
    require_main(webview.label())?;
    buffer()
        .try_lock()
        .map(|b| b.page(before, errors_only))
        .map_err(|_| "Diagnostics busy; retry")
}

#[tauri::command]
pub fn diagnostics_clear(webview: tauri::Webview) -> Result<(), &'static str> {
    require_main(webview.label())?;
    buffer()
        .try_lock()
        .map(|mut b| b.clear())
        .map_err(|_| "Diagnostics busy; retry")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn observer_preserves_results_without_retaining_raw_errors() {
        let id = operation();
        let private = "https://private.example/?token=secret-cookie";
        let result: kuriume_provider::Result<()> =
            observe(Event::SourceResolve, "builtin:age", id, None, async {
                Err(kuriume_provider::ProviderError::Network(private.into()))
            })
            .await;
        assert!(
            result.unwrap_err().to_string().contains(private),
            "caller behavior is unchanged"
        );
        let snapshot = buffer().lock().unwrap().page(None, false);
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.input.details.operation == Some(id))
            .unwrap();
        assert_eq!(entry.input.details.code, Some(Code::Network));
        assert_eq!(entry.input.details.provider, Some(Provider::Agedm));
        assert!(!serde_json::to_string(&snapshot).unwrap().contains(private));
        assert_eq!(
            observe(
                Event::CatalogRequest,
                "AniList",
                operation(),
                Some(Action::Search),
                async { Ok(42) }
            )
            .await
            .unwrap(),
            42
        );
    }
    fn input(operation: u64) -> Input {
        Input {
            event: Event::PlayerError,
            level: Level::Error,
            details: Details {
                operation: Some(operation),
                code: Some(Code::Timeout),
                ..Details::default()
            },
        }
    }
    #[test]
    fn diagnostics_bound_count_bytes_and_duplicate_growth() {
        let mut b = Buffer::default();
        for i in 0..10_000 {
            b.push(input(i), i);
        }
        assert_eq!(b.entries.len(), MAX_ENTRIES);
        assert!(b.bytes <= MAX_BYTES);
        assert_eq!(b.bytes, b.entries.iter().map(|(_, n)| n).sum::<usize>());
        assert_eq!(b.evicted, 9_000);
        for i in 10_000..50_000 {
            b.push(input(9_999), i);
        }
        assert_eq!(b.entries.len(), MAX_ENTRIES);
        assert!(b.entries.back().unwrap().0.repeats > 30_000);
        assert_eq!(
            b.bytes,
            b.entries
                .iter()
                .map(|(e, _)| serde_json::to_vec(e).unwrap().len())
                .sum::<usize>()
        );
        // Exercise the byte cap independently of the entry-count cap.
        b.entries = (0..400)
            .map(|id| {
                (
                    Entry {
                        id,
                        at: 0,
                        last_at: 0,
                        repeats: 1,
                        input: input(id),
                    },
                    MAX_ENTRY_BYTES,
                )
            })
            .collect();
        b.bytes = 400 * MAX_ENTRY_BYTES;
        b.trim();
        assert_eq!(b.bytes, MAX_BYTES);
        assert_eq!(b.entries.len(), 256);
    }
    #[test]
    fn diagnostics_pages_filter_clear_and_restart_are_bounded() {
        let mut b = Buffer::default();
        for i in 0..120 {
            let mut e = input(i);
            if i % 2 == 0 {
                e.level = Level::Info;
            }
            b.push(e, i);
        }
        let first = b.page(None, true);
        assert_eq!(first.entries.len(), PAGE_SIZE);
        assert!(first.has_more);
        let second = b.page(first.entries.last().map(|e| e.id), true);
        assert_eq!(second.entries.len(), 10);
        assert!(!second.has_more);
        let id = b.next_id;
        b.clear();
        assert_eq!(b.bytes, 0);
        assert!(b.entries.is_empty());
        b.push(input(999), 999);
        assert!(b.entries.front().unwrap().0.id > id);
        assert!(Buffer::default().page(None, false).entries.is_empty());
    }
    #[test]
    fn diagnostics_reject_secrets_and_untrusted_webviews() {
        for field in ["url", "cookie", "token", "stack", "title"] {
            let data = serde_json::json!({ "event":"ui_error", "level":"error", "details": { field: "secret" } });
            assert!(serde_json::from_value::<Input>(data).is_err());
        }
        assert!(serde_json::from_value::<Input>(serde_json::json!({"event":"ui_error","level":"error","details":{"code":"https://secret"}})).is_err());
        assert!(require_main("sniffer-1").is_err());
        assert!(require_main("main").is_ok());
    }

    #[test]
    fn error_messages_are_useful_redacted_and_byte_bounded() {
        let raw = "manifestLoadError HTTP 403 https://user:pass@cdn.example/path?token=SECRET\nAuthorization: Bearer AUTH_SECRET\nCookie: session=COOKIE_SECRET; other=OTHER_SECRET\ncaused by: connection reset at /Users/private/movie and C:\\Users\\private\\movie user@example.com";
        let safe = sanitize_message(raw);
        assert!(safe.contains("manifestLoadError HTTP 403"));
        assert!(safe.contains("caused by: connection reset"));
        for private in [
            "SECRET",
            "private",
            "cdn.example",
            "user@example",
            "user:pass",
        ] {
            assert!(!safe.contains(private), "{safe}");
        }
        assert!(!safe.contains('\n'));
        assert!(sanitize_message(&"异常".repeat(2048)).len() <= 1024);
        let mut b = Buffer::default();
        for i in 0..2000 {
            let mut entry = input(i);
            entry.details.message = Some("decoder returned an invalid sample; ".repeat(100));
            b.push(entry, i);
        }
        assert!(b.bytes <= MAX_BYTES);
        assert!(
            b.entries.len() < MAX_ENTRIES,
            "long errors must exercise the byte cap"
        );
        assert_eq!(
            b.bytes,
            b.entries
                .iter()
                .map(|(entry, _)| serde_json::to_vec(entry).unwrap().len())
                .sum::<usize>()
        );
        let mut entry = input(9000);
        entry.details.message = Some(raw.into());
        b.push(entry, 9000);
        assert_eq!(
            b.entries.back().unwrap().0.input.details.message.as_deref(),
            Some(safe.as_str())
        );
    }
}
