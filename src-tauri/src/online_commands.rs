//! Tauri commands for the online-source rule engine.
//!
//! Manages a set of [`Rule`]s and exposes search / episode-list / rule-CRUD
//! operations to the frontend, plus a WebView-based video URL sniffer.

use kuriume_provider::{OnlineRoad, OnlineSearchResult, Rule, RuleEngine};
use std::collections::HashMap;
use std::error::Error as StdError;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{command, AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

static SNIFFER_COUNTER: AtomicU64 = AtomicU64::new(0);

// ── State ────────────────────────────────────────────────────────

/// Holds all registered online-source rule engines, keyed by rule name.
pub struct OnlineSourceState {
    engines: Mutex<HashMap<String, RuleEngine>>,
    rules: Mutex<Vec<Rule>>,
}

impl OnlineSourceState {
    pub fn new() -> Self {
        let state = Self {
            engines: Mutex::new(HashMap::new()),
            rules: Mutex::new(Vec::new()),
        };

        // Register built-in rules.
        for rule in kuriume_provider::builtin_rules::all() {
            state.add_rule(rule);
        }

        state
    }

    /// Register a rule and create its engine.
    pub fn add_rule(&self, rule: Rule) {
        let name = rule.name.clone();
        let engine = RuleEngine::new(rule.clone());
        self.rules.lock().unwrap().push(rule);
        self.engines.lock().unwrap().insert(name, engine);
    }

    /// Remove a rule by name.
    pub fn remove_rule(&self, name: &str) {
        self.rules.lock().unwrap().retain(|r| r.name != name);
        self.engines.lock().unwrap().remove(name);
    }

    /// Get a snapshot of all rule names.
    pub fn list_names(&self) -> Vec<String> {
        self.rules.lock().unwrap().iter().map(|r| r.name.clone()).collect()
    }

    /// Get a snapshot of all rules.
    pub fn list_rules(&self) -> Vec<Rule> {
        self.rules.lock().unwrap().clone()
    }
}

impl Default for OnlineSourceState {
    fn default() -> Self {
        Self::new()
    }
}

// ── Commands ─────────────────────────────────────────────────────

/// List all registered online-source rule names.
#[command]
pub(crate) async fn online_source_list(
    state: State<'_, OnlineSourceState>,
) -> Result<Vec<String>, String> {
    Ok(state.list_names())
}

/// Get all registered rules (for UI display / editing).
#[command]
pub(crate) async fn online_source_list_rules(
    state: State<'_, OnlineSourceState>,
) -> Result<Vec<Rule>, String> {
    Ok(state.list_rules())
}

/// Add or update an online-source rule.
#[command]
pub(crate) async fn online_source_add_rule(
    state: State<'_, OnlineSourceState>,
    rule: Rule,
) -> Result<(), String> {
    // Remove old version if exists, then add new
    state.remove_rule(&rule.name);
    state.add_rule(rule);
    Ok(())
}

/// Remove an online-source rule by name.
#[command]
pub(crate) async fn online_source_remove_rule(
    state: State<'_, OnlineSourceState>,
    name: &str,
) -> Result<(), String> {
    state.remove_rule(name);
    Ok(())
}

/// Search for anime on a specific online source.
#[command]
pub(crate) async fn online_source_search(
    state: State<'_, OnlineSourceState>,
    source: &str,
    keyword: &str,
) -> Result<Vec<OnlineSearchResult>, String> {
    let rule = {
        let engines = state.engines.lock().unwrap();
        let engine = engines
            .get(source)
            .ok_or_else(|| format!("Online source not found: {source}"))?;
        engine.rule().clone()
    };
    let engine = RuleEngine::new(rule);
    engine.search(keyword).await.map_err(|e| e.to_string())
}

/// Simple echo test to diagnose IPC issues.
#[command]
pub(crate) async fn online_source_echo(
    source: String,
    page_url: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("client build: {e}"))?;

    // Test 1: search URL (known to work via RuleEngine)
    let search_url = "https://www.agedm.io/search?query=test";
    let r1 = match client.get(search_url).send().await {
        Ok(resp) => format!("search={}", resp.status()),
        Err(e) => format!("search=ERR:{e}"),
    };

    // Test 2: detail URL
    let r2 = match client.get(&page_url).send().await {
        Ok(resp) => format!("detail={}", resp.status()),
        Err(e) => format!("detail=ERR:{e}"),
    };

    Ok(format!("{r1} | {r2}"))
}

/// Get episodes (roads) from an anime page on an online source.
#[command]
pub(crate) async fn online_source_episodes(
    state: State<'_, OnlineSourceState>,
    source: String,
    page_url: String,
) -> Result<Vec<OnlineRoad>, String> {
    let rule = {
        let engines = state.engines.lock().unwrap();
        let engine = engines
            .get(source.as_str())
            .ok_or_else(|| format!("Online source not found: {source}"))?;
        engine.rule().clone()
    };
    let engine = RuleEngine::new(rule);
    engine.get_episodes(&page_url).await.map_err(|e| e.to_string())
}

// ── Video URL sniffer ────────────────────────────────────────────

/// JavaScript injected into the sniffer WebView before page scripts.
///
/// Hooks network APIs and media element src to intercept video URLs.
/// When found, signals Rust by setting `document.title` to a sentinel value.
/// The `on_document_title_changed` callback in Rust detects this and extracts
/// the URL.
const SNIFFER_SCRIPT: &str = r#"
(function() {
    var __found = false;

    function __isVideoUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (/\.m3u8|\.mp4|\.flv|\.ts\b/i.test(url)) return true;
        if (/\/video\/|\/hls\/|\/m3u8|type=m3u8|mime=video/i.test(url)) return true;
        return false;
    }

    function __report(url, force) {
        if (__found) return;
        if (!url || typeof url !== 'string') return;
        if (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return;
        if (!force && !__isVideoUrl(url)) return;
        __found = true;
        console.log('[sniffer] found video URL:', url);
        document.title = '__SNIFF_RESULT__:' + url;
    }

    // ── XHR hooks ────────────────────────────────────────────────
    var __origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__snUrl = typeof url === 'string' ? url : String(url);
        __report(this.__snUrl);
        return __origOpen.apply(this, arguments);
    };
    var __origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        var xhr = this;
        xhr.addEventListener('load', function() {
            var url = xhr.responseURL || xhr.__snUrl;
            if (url) __report(url);
            try {
                var ct = xhr.getResponseHeader('content-type') || '';
                if (/mpegurl|video\//i.test(ct) && url) __report(url, true);
            } catch(e) {}
        });
        return __origSend.apply(this, arguments);
    };

    // ── fetch hook ───────────────────────────────────────────────
    var __origFetch = window.fetch;
    window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        __report(url);
        var p = __origFetch.apply(this, arguments);
        p.then(function(resp) {
            if (resp && resp.url) __report(resp.url);
            if (resp && resp.headers) {
                var ct = resp.headers.get('content-type') || '';
                if (/mpegurl|video\//i.test(ct) && resp.url) __report(resp.url, true);
            }
        }).catch(function(){});
        return p;
    };

    // ── HLS.js hook — intercept loadSource() directly ────────────
    function __hookHls(H) {
        if (!H || !H.prototype || H.prototype.__snHooked) return;
        H.prototype.__snHooked = true;
        var orig = H.prototype.loadSource;
        if (orig) {
            H.prototype.loadSource = function(url) {
                __report(url, true);
                return orig.apply(this, arguments);
            };
        }
    }
    if (window.Hls) __hookHls(window.Hls);
    try {
        var __hlsVal = window.Hls;
        Object.defineProperty(window, 'Hls', {
            set: function(v) { __hlsVal = v; __hookHls(v); },
            get: function() { return __hlsVal; },
            configurable: true
        });
    } catch(e) {}

    // ── flv.js hook — intercept createPlayer() ───────────────────
    function __hookFlv(f) {
        if (!f || f.__snHooked) return;
        f.__snHooked = true;
        var orig = f.createPlayer;
        if (orig) {
            f.createPlayer = function(conf) {
                if (conf && conf.url) __report(conf.url, true);
                return orig.apply(this, arguments);
            };
        }
    }
    if (window.flvjs) __hookFlv(window.flvjs);
    try {
        var __flvVal = window.flvjs;
        Object.defineProperty(window, 'flvjs', {
            set: function(v) { __flvVal = v; __hookFlv(v); },
            get: function() { return __flvVal; },
            configurable: true
        });
    } catch(e) {}

    // ── Element creation hook ────────────────────────────────────
    var __origCreate = document.createElement.bind(document);
    document.createElement = function(tag) {
        var el = __origCreate(tag);
        var t = tag.toLowerCase();
        if (t === 'video' || t === 'source') {
            var origSet = el.setAttribute.bind(el);
            el.setAttribute = function(n, v) {
                if (n === 'src') __report(v);
                return origSet(n, v);
            };
            Object.defineProperty(el, 'src', {
                set: function(v) { __report(v); origSet('src', v); },
                get: function() { return el.getAttribute('src'); }
            });
        }
        return el;
    };

    // ── HTMLMediaElement.src hook ─────────────────────────────────
    var __mp = HTMLMediaElement.prototype;
    var __sd = Object.getOwnPropertyDescriptor(__mp, 'src');
    if (__sd && __sd.set) {
        Object.defineProperty(__mp, 'src', {
            set: function(v) { __report(v); __sd.set.call(this, v); },
            get: __sd.get, configurable: true
        });
    }

    // ── MutationObserver — watch for <video> elements ────────────
    function __watchVideo(v) {
        if (v.__snWatched) return;
        v.__snWatched = true;
        ['playing', 'loadeddata'].forEach(function(ev) {
            v.addEventListener(ev, function() {
                if (this.currentSrc && this.currentSrc.indexOf('blob:') !== 0) {
                    __report(this.currentSrc, true);
                }
            });
        });
    }
    new MutationObserver(function(muts) {
        for (var i = 0; i < muts.length; i++) {
            var nodes = muts[i].addedNodes;
            for (var j = 0; j < nodes.length; j++) {
                var n = nodes[j];
                if (n.nodeName === 'VIDEO') __watchVideo(n);
                if (n.querySelectorAll) n.querySelectorAll('video').forEach(__watchVideo);
            }
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // ── DOM scanning ─────────────────────────────────────────────
    function __scanDOM() {
        document.querySelectorAll('video').forEach(function(el) {
            __watchVideo(el);
            var s = el.getAttribute('src') || el.src;
            if (s) __report(s);
            if (el.currentSrc) __report(el.currentSrc, true);
        });
        document.querySelectorAll('source[src]').forEach(function(el) {
            __report(el.getAttribute('src') || el.src);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', __scanDOM);
    } else {
        setTimeout(__scanDOM, 500);
    }
    setTimeout(__scanDOM, 2000);
    setTimeout(__scanDOM, 5000);
    setTimeout(__scanDOM, 8000);
    setTimeout(__scanDOM, 12000);
})();
"#;

/// Create a hidden WebView window that loads `episode_url`, intercepts
/// network requests for video URLs (.m3u8/.mp4/.flv), and returns the
/// first one found.
///
/// Communication between JS and Rust uses `document.title` changes:
/// the init-script sets `document.title = '__SNIFF_RESULT__:' + url`
/// when a video URL is found, and `on_document_title_changed` on the
/// Rust side detects the sentinel prefix and extracts the URL.
///
/// Many anime sites embed video in an `<iframe>` pointing to a third-party
/// player. The init-script hooks only run in the top-level document, not inside
/// cross-origin iframes. To handle this, we first fetch the episode page HTML
/// server-side, extract the `<iframe>` src, and load *that* URL in the sniffer
/// WebView so the hooks can capture the real video URL.
///
/// Returns the video URL or an error (timeout after 30s).
#[command]
pub(crate) async fn sniff_video_url(
    app: AppHandle,
    episode_url: String,
) -> Result<String, String> {
    let sniff_target = resolve_sniff_target(&episode_url)
        .await
        .unwrap_or_else(|| episode_url.clone());
    eprintln!("[sniffer] episode_url: {episode_url}");
    eprintln!("[sniffer] sniff_target: {sniff_target}");

    let (tx, rx) = oneshot::channel::<String>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx_title = tx.clone();

    let url: tauri::Url = sniff_target
        .parse()
        .map_err(|_| format!("Invalid URL: {sniff_target}"))?;

    // Close any leftover sniffer windows from previous attempts
    #[cfg(desktop)]
    for (label, win) in app.webview_windows() {
        if label.starts_with("sniffer-") {
            let _ = win.close();
        }
    }

    let label = format!("sniffer-{}", SNIFFER_COUNTER.fetch_add(1, Ordering::Relaxed));

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url));
    #[cfg(desktop)]
    {
        builder = builder.title("Sniffer").visible(false);
    }
    let sniffer_webview = builder
        .initialization_script(SNIFFER_SCRIPT)
        .on_document_title_changed(move |_win, title| {
            const PREFIX: &str = "__SNIFF_RESULT__:";
            if let Some(video_url) = title.strip_prefix(PREFIX) {
                eprintln!("[sniffer] title-change captured: {video_url}");
                if let Some(tx) = tx_title.lock().unwrap().take() {
                    let _ = tx.send(video_url.to_string());
                }
            }
        })
        .build()
        .map_err(|e| format!("Failed to create sniffer window: {e}"))?;

    // On iOS, tao creates a new UIWindow for each WebviewWindow.
    // This new UIWindow becomes the key window and covers the entire screen.
    // We hide the sniffer UIWindow and restore the main UIWindow as key.
    // The WKWebView stays in the sniffer window (hidden) so it can still load
    // and fire the KVO title observer; we don't reparent it.
    #[cfg(target_os = "ios")]
    {
        let _ = sniffer_webview.with_webview(|platform_webview| {
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::{AnyClass, AnyObject, NSObject};

                let wkwv = platform_webview.inner() as *const AnyObject;

                // Get the UIWindow that the sniffer WKWebView belongs to
                let sniffer_window: *const AnyObject = msg_send![wkwv, window];

                // Find the main UIWindow (the one that is NOT the sniffer window)
                let ui_app_cls = AnyClass::get(c"UIApplication").unwrap();
                let shared_app: *const AnyObject = msg_send![ui_app_cls, sharedApplication];
                let windows: *const NSObject = msg_send![shared_app, windows];
                let count: usize = msg_send![windows, count];
                let mut main_window: *const AnyObject = std::ptr::null();
                for i in 0..count {
                    let win: *const AnyObject = msg_send![windows, objectAtIndex: i];
                    if win != sniffer_window {
                        main_window = win;
                        break;
                    }
                }

                // Hide the sniffer UIWindow entirely and make it non-interactive
                if !sniffer_window.is_null() {
                    let _: () = msg_send![sniffer_window, setHidden: true];
                    let _: () = msg_send![sniffer_window, setUserInteractionEnabled: false];
                    // Resign key so it doesn't steal events
                    let _: () = msg_send![sniffer_window, resignKeyWindow];
                    eprintln!("[sniffer-ios] hidden sniffer UIWindow");
                }

                // Restore the main window as key window
                if !main_window.is_null() {
                    let _: () = msg_send![main_window, makeKeyAndVisible];
                    eprintln!("[sniffer-ios] restored main UIWindow as key");
                }
            }
        });
    }

    // Wait for result with timeout (30s to allow for slow decryption/WASM)
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), rx).await;

    // Clean up: close/remove the sniffer
    #[cfg(desktop)]
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    #[cfg(target_os = "ios")]
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.with_webview(|platform_webview| {
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::{AnyClass, AnyObject, NSObject};
                let wkwv = platform_webview.inner() as *const AnyObject;
                // Get the sniffer UIWindow before removing the webview
                let sniffer_win: *const AnyObject = msg_send![wkwv, window];
                let _: () = msg_send![wkwv, stopLoading];
                let _: () = msg_send![wkwv, removeFromSuperview];
                // Ensure the sniffer UIWindow is destroyed
                if !sniffer_win.is_null() {
                    let _: () = msg_send![sniffer_win, setHidden: true];
                    let _: () = msg_send![sniffer_win, setUserInteractionEnabled: false];
                    let _: () = msg_send![sniffer_win, resignKeyWindow];
                }
                // Always re-ensure main window is key
                let ui_app_cls = AnyClass::get(c"UIApplication").unwrap();
                let shared_app: *const AnyObject = msg_send![ui_app_cls, sharedApplication];
                let windows: *const NSObject = msg_send![shared_app, windows];
                let count: usize = msg_send![windows, count];
                for i in 0..count {
                    let w: *const AnyObject = msg_send![windows, objectAtIndex: i];
                    if w != sniffer_win {
                        let _: () = msg_send![w, makeKeyAndVisible];
                        break;
                    }
                }
                eprintln!("[sniffer-ios] cleaned up sniffer WKWebView + UIWindow");
            }
        });
    }

    match result {
        Ok(Ok(url)) => {
            eprintln!("[sniffer] success: {url}");
            Ok(url)
        }
        Ok(Err(_)) => {
            eprintln!("[sniffer] error: channel closed unexpectedly");
            Err("Sniffer channel closed unexpectedly".into())
        }
        Err(_) => {
            eprintln!("[sniffer] error: timed out after 30s");
            Err("Video URL sniffing timed out (30s)".into())
        }
    }
}

/// Fetch the episode page HTML and try to extract an `<iframe>` src.
/// If found, return the iframe URL; otherwise return the original URL.
async fn resolve_sniff_target(episode_url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .ok()?;

    let html = client
        .get(episode_url)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    // Look for <iframe ... src="..."> that looks like a video player
    // Use a simple regex to be lightweight (no need for full HTML parser here)
    let re = regex::Regex::new(r#"<iframe[^>]+src="([^"]+)"[^>]*>"#).ok()?;
    for cap in re.captures_iter(&html) {
        let src = &cap[1];
        // Filter: skip iframes that are obviously not video players (ads, analytics, etc.)
        if src.contains("google") || src.contains("facebook") || src.contains("twitter")
            || src.contains("baidu.com/hm") || src.contains("analytics")
        {
            continue;
        }
        // Return the first plausible player iframe
        return Some(src.to_string());
    }

    None
}
