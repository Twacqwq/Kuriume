## Context

Kuriume's mobile UI was built by adding Tailwind responsive breakpoints (`md:`) to the desktop layout. The result is a shrunken desktop experience rather than a mobile-native one. Key pain points:

- **Grid density**: 3-column grid at 375px = ~117px per card — covers are unreadable, titles truncate heavily
- **Information architecture**: Hero banner (208px) + detail page vertical stack consume most of the viewport before useful content appears
- **Missing interactions**: Delete/edit actions use hover-only patterns invisible to touch users
- **Disabled capability**: AGE online playback is gated behind `cfg(desktop)` — the `sniff_video_url` command returns an error on mobile, and `source-picker-dialog.tsx` filters out online source tabs when `isMobile` is true
- **Modal friction**: Source/subtitle/resolution selection requires a separate dialog before entering the player page, adding unnecessary steps

Current affected files:
- **Routes**: `__root.tsx`, `index.tsx`, `search.tsx`, `calendar.tsx`, `history.tsx`, `watchlist.tsx`, `me.tsx`, `anime/$id.tsx`, `anime/$id/episode/$ep.tsx`
- **Components**: `anime-grid.tsx`, `hero-banner.tsx`, `bottom-tab-bar.tsx`, `sidebar.tsx`, `anime-detail.tsx`, `source-picker-dialog.tsx`, `torrent-player.tsx`, `video-player.tsx`, `search-panel.tsx`
- **Hooks**: `use-torrent-source.ts`, `use-online-source.ts`, `use-video-sniffer.ts`
- **Rust**: `src-tauri/src/online_commands.rs` (`sniff_video_url` mobile stub)

## Goals / Non-Goals

**Goals:**
- Mobile-native page layouts with 2-column grids, compact banners, and horizontal detail hero
- Unified inline source selection on the player page across all platforms (removing SourcePickerDialog)
- AGE online playback working on iOS and Android via mobile WebView sniffer
- Touch-native action patterns: swipe-to-delete, long-press context menu
- Restructured bottom tab bar: [Home, Calendar, Watchlist, History, Me] with search moved to home page

**Non-Goals:**
- Offline/download functionality
- Picture-in-picture mode
- Auto-rotate fullscreen on landscape detection
- Tablet-specific layouts (tablets use desktop breakpoint)
- New anime data sources or providers
- Changes to the mpv rendering pipeline or torrent engine

## Decisions

### 1. Mobile grid column count: 2 columns

**Decision**: Use 2-column grid on mobile (`<md`) instead of current 3-column.

**Rationale**: At 375px with 16px padding on each side and 12px gap: `(375 - 32 - 12) / 2 ≈ 166px` per card. With `aspect-2/3` this gives 166×249px cards — large enough to identify cover art and display full titles. The current 3-column yields ~117px which is too narrow.

**Alternative considered**: Horizontal scroll card rows (Netflix-style). Rejected because there is only one content category ("all anime"), making horizontal sections artificial. Vertical grid with 2 columns maximizes information density for a single-category list.

**Affected components**: `anime-grid.tsx` (column count logic), `watchlist.tsx`, `calendar.tsx` (grid classes).

### 2. Search moved to home page top bar

**Decision**: Replace the Search tab in the bottom tab bar with History. Add a search input bar at the top of the home page that expands to the full-screen search panel on tap.

**Rationale**: Search is an infrequent action that doesn't justify a persistent tab slot. History is accessed frequently (continue watching) and was previously desktop-sidebar-only. A top search bar is the standard mobile pattern (YouTube, Crunchyroll, etc.).

**Affected components**: `bottom-tab-bar.tsx` (tab list), `index.tsx` (add search bar), `search-panel.tsx` (triggered from home page instead of tab).

### 3. Inline source selection — remove SourcePickerDialog

**Decision**: Delete `source-picker-dialog.tsx`. Move all source/subtitle-group/resolution selection into the player page (`anime/$id/episode/$ep.tsx`) as inline UI. Apply to both mobile and desktop for consistency.

**Layout**:
- Mobile (`<md`): Source tabs, subtitle chips, resolution chips, and episode grid rendered vertically below the player
- Desktop (`≥md`): Same controls rendered in a sidebar panel beside the player (same `flex-col md:flex-row` pattern already used)

**Auto-selection logic**: When entering the player page, automatically select the best source:
1. If the user has previously played this anime, use the last provider + group (read from watch history in SQLite)
2. Otherwise, try providers in order: Mikan → Nyaa → DMHY, selecting the first with results
3. Apply stored subtitle/resolution preferences from settings

**Route params change**: Remove `groupId`, `resolution`, `subtitle`, `provider` from player page search params. Keep only `t` (resume timestamp) and `onlineUrl`. Source selection becomes internal component state, persisted to history on play.

**Affected components**: Remove `source-picker-dialog.tsx`. Refactor `anime/$id/episode/$ep.tsx` to own source selection state. Simplify `anime-detail.tsx` episode click handler to navigate directly without opening a dialog.

### 4. Mobile WebView sniffer for online playback

**Decision**: Implement `sniff_video_url` on mobile using Tauri v2's `WebviewWindowBuilder`, which creates a native WKWebView (iOS) or android.webkit.WebView (Android).

**Approach**: The existing desktop implementation creates a hidden WebView, injects `SNIFFER_SCRIPT` (hooks `XMLHttpRequest.open`, `fetch`, `HTMLMediaElement.src`), and communicates results via `document.title` changes detected by `on_document_title_changed`. This same pattern will be used for mobile:

1. Remove the `cfg(not(desktop))` stub that returns `Err("not supported")`
2. Make the existing `cfg(desktop)` implementation unconditional (or add a separate `cfg(mobile)` block if API differences require it)
3. Verify that `WebviewWindowBuilder::new().on_document_title_changed()` works on mobile Tauri targets
4. If `on_document_title_changed` is not available on mobile, fall back to IPC: inject `window.__TAURI__.invoke('__sniffer_result', { url })` in the sniffer script

**Risk**: Mobile WebViews may have stricter cross-origin policies or JS injection limitations. This needs a spike test on a real device.

**Affected files**: `src-tauri/src/online_commands.rs` (remove cfg gate), `src-tauri/tauri.conf.json` (may need sniffer capability for mobile), `source-picker-dialog.tsx` removal already handles the frontend side.

### 5. Touch action patterns

**Decision**:
- **History page**: Swipe-to-delete using a horizontal touch gesture handler (touchstart/touchmove/touchend). Swipe left reveals a delete button; releasing triggers delete. Desktop retains hover-to-reveal.
- **Watchlist page**: Long-press (500ms) on a card triggers a context menu (built with a simple absolutely-positioned menu, not a native context menu). Options: change status, remove. Desktop retains hover overlay buttons.

**Affected components**: `history.tsx` (add swipe gesture handler), `watchlist.tsx` (add long-press handler + context menu).

### 6. Detail page mobile hero layout

**Decision**: On mobile, render cover image (80×120px) and metadata side-by-side in a horizontal flex row, instead of stacking cover above text. This reduces hero section height from ~60% of viewport to ~35%, making episodes visible on first screen.

**Affected component**: `anime-detail.tsx` (hero section flex direction).

## Risks / Trade-offs

- **[Mobile WebView sniffer may not work]** → Mitigation: Spike test `WebviewWindowBuilder` on iOS sim first. If `on_document_title_changed` is unavailable, use IPC-based communication. If WebView creation fails entirely on mobile, keep the `cfg(not(desktop))` gate and document the limitation.
- **[Removing SourcePickerDialog is a breaking change to navigation flow]** → Mitigation: Auto-selection logic ensures users don't need to manually pick a source on first play. All selection options are still accessible inline. Users who memorized the old flow need to adapt.
- **[2-column grid reduces visible items per screen]** → Trade-off accepted: Readability and touch target size are more important than density on mobile. Desktop grid columns unchanged.
- **[Swipe-to-delete may conflict with system back gesture on iOS]** → Mitigation: Only enable horizontal swipe on the list item element, not the full page. Use a minimum threshold (80px) to distinguish from navigation gestures.
- **[Long-press detection may interfere with scroll]** → Mitigation: Cancel long-press timer if touch moves more than 10px from start position.
