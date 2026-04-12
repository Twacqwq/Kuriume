## 1. Mobile Layout — Grid and Navigation

- [x] 1.1 Update `anime-grid.tsx` column count logic: return 2 columns when width < 768px (currently returns 3)
- [x] 1.2 Update `hero-banner.tsx` mobile height from `h-52` to `h-40`
- [x] 1.3 Restructure `bottom-tab-bar.tsx` tabs: replace Search with History, reorder to [Home, Calendar, Watchlist, History, Me]
- [x] 1.4 Add search bar to `index.tsx` top (mobile only, tapping opens `SearchPanel`)
- [x] 1.5 Update `watchlist.tsx` grid to 2 columns on mobile (`grid-cols-2` instead of current implementation)
- [x] 1.6 Update `calendar.tsx` grid to 2 columns on mobile (verify existing `grid-cols-2` works correctly)

## 2. Mobile Layout — Detail and Me Pages

- [x] 2.1 Refactor `anime-detail.tsx` hero section: mobile uses horizontal flex (cover 80×120px beside metadata) instead of vertical stack
- [x] 2.2 Ensure episode list is visible on first screen without scrolling on mobile detail page
- [x] 2.3 Update `me.tsx`: add "Continue watching" section with up to 3 recent history entries, progress bars, and resume play buttons
- [x] 2.4 Add direct Settings menu item to `me.tsx` without nested navigation

## 3. Inline Source Selection — Frontend

- [x] 3.1 Remove `source-picker-dialog.tsx` component file
- [x] 3.2 Remove SourcePickerDialog import and usage from `anime-detail.tsx` — episode click navigates directly to player page
- [x] 3.3 Simplify player page route params in `anime/$id/episode/$ep.tsx`: remove `groupId`, `resolution`, `subtitle`, `provider` search params; keep only `t` and `onlineUrl`
- [x] 3.4 Create inline source panel UI in `anime/$id/episode/$ep.tsx`: provider tabs, subtitle group chips, resolution chips, episode grid
- [x] 3.5 Implement mobile layout for inline source panel: vertical stack below player (`flex-col` when `<md`)
- [x] 3.6 Implement desktop layout for inline source panel: sidebar beside player (`md:flex-row`)
- [x] 3.7 Implement auto-selection logic: read last provider/group from watch history, fall back to Mikan → Nyaa → DMHY, apply subtitle/resolution preferences
- [x] 3.8 Implement inline source/subtitle/resolution switching: changing any option reloads playback without page navigation
- [x] 3.9 Implement inline episode switching: tapping a different episode starts playback without page navigation

## 4. Mobile Video Sniffer — Backend

- [x] 4.1 In `online_commands.rs`, remove `cfg(not(desktop))` stub that returns `Err("not supported")`
- [x] 4.2 Make the `sniff_video_url` implementation work on mobile: either remove the `cfg(desktop)` gate or add a `cfg(mobile)` implementation using `WebviewWindowBuilder`
- [x] 4.3 Verify `on_document_title_changed` callback works on mobile Tauri targets; if not, implement IPC-based fallback (`window.__TAURI__.invoke`)
- [x] 4.4 Update `tauri.conf.json` / capabilities if needed for mobile WebView sniffer permissions
- [x] 4.5 Test video sniffing on iOS simulator with an AGE episode URL

## 5. Mobile Video Sniffer — Frontend

- [x] 5.1 Remove the `!isMobile` filter on online source tabs (previously in `source-picker-dialog.tsx`, now in inline source panel from task 3.4)
- [x] 5.2 Ensure online source tab and playback flow works on mobile in the inline source panel

## 6. Mobile Touch Actions

- [x] 6.1 Implement swipe-to-delete gesture on `history.tsx` for mobile: touchstart/touchmove/touchend with 80px threshold, reveals delete button on left-swipe
- [x] 6.2 Add vertical movement cancellation (>10px) to prevent swipe-delete from interfering with scroll
- [x] 6.3 Preserve desktop hover-to-reveal delete button on `history.tsx`
- [x] 6.4 Implement long-press context menu on `watchlist.tsx` for mobile: 500ms press triggers menu with status change and remove options
- [x] 6.5 Add movement cancellation (>10px) to prevent long-press from triggering during scroll
- [x] 6.6 Preserve desktop hover overlay action buttons on `watchlist.tsx`

## 7. Verification

- [x] 7.1 Run `tsc --noEmit` to verify zero TypeScript errors
- [x] 7.2 Run `cargo check` to verify zero Rust compilation errors
- [x] 7.3 Visually verify all pages at 375px viewport width in dev tools
- [x] 7.4 Visually verify all pages at ≥768px viewport width (desktop layout unchanged)
