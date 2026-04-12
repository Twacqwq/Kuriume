## Why

The current mobile UI is a responsive adaptation of the desktop layout rather than a purpose-built mobile experience. This results in cramped 3-column grids (117px per card at 375px width), information density issues (hero banner consuming 40% of viewport), inaccessible actions (hover-only delete/edit buttons), and online playback (AGE) being entirely disabled on mobile via `cfg(not(desktop))`. The mobile experience needs a ground-up redesign to match native app quality, and online source playback must work on all platforms.

## What Changes

- **Home page grid**: Change from 3-column to 2-column grid on mobile (<md), increasing card width from ~117px to ~166px for readable cover art and titles
- **Home page search**: Move search from bottom tab bar to a persistent search bar at the top of the home page; free up a tab slot for History
- **Hero banner**: Reduce mobile banner height from h-52 (208px) to h-40 (160px) to decrease viewport dominance
- **Bottom tab bar restructure**: Change tabs from [Home, Calendar, Search, Watchlist, Me] to [Home, Calendar, Watchlist, History, Me], moving search to home page top bar
- **Anime detail page**: Change mobile hero from vertical stack (cover above text) to horizontal layout (cover beside text), ensuring episodes are visible on first screen
- **Player page — inline source selection (all platforms)**: **BREAKING** — Remove `SourcePickerDialog` component entirely. Move source/subtitle-group/resolution selection inline into the player page. Users enter the player page directly from episode click; the page auto-selects the optimal source and allows switching without leaving
- **Player page — mobile layout**: Source tabs, subtitle-group chips, resolution chips, and episode list displayed below the player in a scrollable column
- **Player page — desktop layout**: Same inline controls displayed in a sidebar panel beside the player
- **Online playback on mobile**: Implement WebView-based video URL sniffing on iOS (WKWebView) and Android (android.webkit.WebView) by removing the `cfg(not(desktop))` gate on `sniff_video_url` and implementing mobile WebView sniffer. Show online source tabs on mobile in the source panel
- **History page**: Add swipe-to-delete gesture for mobile (replacing hover-only trash button)
- **Watchlist page**: Change to 2-column grid on mobile; add long-press context menu for status change and delete (replacing hover-only action buttons)
- **Calendar page**: Change to 2-column grid on mobile
- **Me page**: Add "Continue watching" section with playback progress; provide direct access to Settings

## Capabilities

### New Capabilities
- `mobile-layout`: Mobile-first page layouts — 2-column grids, compressed hero banner, horizontal detail hero, restructured bottom tab bar, and top search bar on home page
- `inline-source-selection`: Unified inline source/subtitle/resolution selection on the player page for all platforms, replacing the SourcePickerDialog modal flow
- `mobile-video-sniffer`: WebView-based video URL sniffing on iOS and Android, enabling AGE online source playback on mobile
- `mobile-touch-actions`: Swipe-to-delete on history, long-press context menu on watchlist — mobile-native action patterns replacing hover interactions

### Modified Capabilities

## Impact

- **Frontend components**: Remove `source-picker-dialog.tsx`. Major changes to `anime-detail.tsx`, `anime-grid.tsx`, `hero-banner.tsx`, `bottom-tab-bar.tsx`, episode route (`anime/$id/episode/$ep.tsx`), `search-panel.tsx`. Moderate changes to `history.tsx`, `watchlist.tsx`, `calendar.tsx`, `me.tsx`, `__root.tsx`
- **Frontend hooks**: `use-torrent-source.ts` and `use-online-source.ts` logic moves from dialog to player page; hooks themselves unchanged
- **Backend Rust**: `src-tauri/src/online_commands.rs` — replace `cfg(not(desktop))` stub with mobile WebView sniffer implementation; may need `tauri.conf.json` capability updates for mobile WebView
- **Route params**: Player page URL search params simplified — remove `groupId`, `resolution`, `subtitle`, `provider`; keep only `t` (resume time) and `onlineUrl`. Source selection state managed internally
- **Platforms affected**: iOS, Android, macOS, Windows (all platforms)
- **Player engines affected**: Both — mpv (torrent) and HTML5 (online/sniffer) playback paths on mobile
