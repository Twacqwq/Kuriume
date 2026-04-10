## ADDED Requirements

### Requirement: Video URL sniffing works on mobile platforms
The `sniff_video_url` Tauri command SHALL function on iOS and Android, using native WebView (WKWebView on iOS, android.webkit.WebView on Android) to load episode pages, inject JavaScript hooks, and extract m3u8/mp4 video URLs.

#### Scenario: Sniffing a video URL on iOS
- **WHEN** the frontend invokes `sniff_video_url` with an episode URL on iOS
- **THEN** the backend creates a hidden WKWebView, loads the URL with injected JS hooks, and returns the discovered video URL

#### Scenario: Sniffing a video URL on Android
- **WHEN** the frontend invokes `sniff_video_url` with an episode URL on Android
- **THEN** the backend creates a hidden android.webkit.WebView, loads the URL with injected JS hooks, and returns the discovered video URL

#### Scenario: Sniffer timeout on mobile
- **WHEN** no video URL is found within the timeout period on mobile
- **THEN** the command returns an error with a descriptive message

### Requirement: Online source tabs visible on mobile
The player page source selection SHALL display online source tabs (e.g., AGE) on mobile viewports. The previous `isMobile` filter that hid online sources SHALL be removed.

#### Scenario: AGE tab visible on mobile player page
- **WHEN** the user views the inline source panel on a mobile viewport
- **THEN** the AGE online source tab is visible alongside torrent provider tabs

#### Scenario: Playing online source on mobile
- **WHEN** the user selects an online source tab and chooses an episode on mobile
- **THEN** the video sniffer extracts the video URL and the HTML5 player begins playback

### Requirement: Mobile sniffer uses same JS injection as desktop
The mobile sniffer SHALL inject the same `SNIFFER_SCRIPT` (hooking XMLHttpRequest.open, fetch, and HTMLMediaElement.src) as the desktop implementation.

#### Scenario: JS hooks intercept video URL on mobile WebView
- **WHEN** the sniffer WebView loads an episode page that dynamically generates a video URL via JavaScript
- **THEN** the injected hooks capture the m3u8/mp4/flv URL and return it to the Rust backend
