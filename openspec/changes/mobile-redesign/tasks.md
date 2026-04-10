## 1. Mobile Layout — Grid and Navigation

- [ ] 1.1 Update `anime-grid.tsx` column count logic: return 2 columns when width < 768px (currently returns 3)
- [ ] 1.2 Update `hero-banner.tsx` mobile height from `h-52` to `h-40`
- [ ] 1.3 Restructure `bottom-tab-bar.tsx` tabs: replace Search with History, reorder to [Home, Calendar, Watchlist, History, Me]
- [ ] 1.4 Add search bar to `index.tsx` top (mobile only, tapping opens `SearchPanel`)
- [ ] 1.5 Update `watchlist.tsx` grid to 2 columns on mobile (`grid-cols-2` instead of current implementation)
- [ ] 1.6 Update `calendar.tsx` grid to 2 columns on mobile (verify existing `grid-cols-2` works correctly)

## 2. Mobile Layout — Detail and Me Pages

- [ ] 2.1 Refactor `anime-detail.tsx` hero section: mobile uses horizontal flex (cover 80×120px beside metadata) instead of vertical stack
- [ ] 2.2 Ensure episode list is visible on first screen without scrolling on mobile detail page
- [ ] 2.3 Update `me.tsx`: add "Continue watching" section with up to 3 recent history entries, progress bars, and resume play buttons
- [ ] 2.4 Add direct Settings menu item to `me.tsx` without nested navigation

## 3. Inline Source Selection — Frontend

- [ ] 3.1 Remove `source-picker-dialog.tsx` component file
- [ ] 3.2 Remove SourcePickerDialog import and usage from `anime-detail.tsx` — episode click navigates directly to player page
- [ ] 3.3 Simplify player page route params in `anime/$id/episode/$ep.tsx`: remove `groupId`, `resolution`, `subtitle`, `provider` search params; keep only `t` and `onlineUrl`
- [ ] 3.4 Create inline source panel UI in `anime/$id/episode/$ep.tsx`: provider tabs, subtitle group chips, resolution chips, episode grid
- [ ] 3.5 Implement mobile layout for inline source panel: vertical stack below player (`flex-col` when `<md`)
- [ ] 3.6 Implement desktop layout for inline source panel: sidebar beside player (`md:flex-row`)
- [ ] 3.7 Implement auto-selection logic: read last provider/group from watch history, fall back to Mikan → Nyaa → DMHY, apply subtitle/resolution preferences
- [ ] 3.8 Implement inline source/subtitle/resolution switching: changing any option reloads playback without page navigation
- [ ] 3.9 Implement inline episode switching: tapping a different episode starts playback without page navigation

## 4. Mobile Video Sniffer — Backend

- [ ] 4.1 In `online_commands.rs`, remove `cfg(not(desktop))` stub that returns `Err("not supported")`
- [ ] 4.2 Make the `sniff_video_url` implementation work on mobile: either remove the `cfg(desktop)` gate or add a `cfg(mobile)` implementation using `WebviewWindowBuilder`
- [ ] 4.3 Verify `on_document_title_changed` callback works on mobile Tauri targets; if not, implement IPC-based fallback (`window.__TAURI__.invoke`)
- [ ] 4.4 Update `tauri.conf.json` / capabilities if needed for mobile WebView sniffer permissions
- [ ] 4.5 Test video sniffing on iOS simulator with an AGE episode URL

## 5. Mobile Video Sniffer — Frontend

- [ ] 5.1 Remove the `!isMobile` filter on online source tabs (previously in `source-picker-dialog.tsx`, now in inline source panel from task 3.4)
- [ ] 5.2 Ensure online source tab and playback flow works on mobile in the inline source panel

## 6. Mobile Touch Actions

- [ ] 6.1 Implement swipe-to-delete gesture on `history.tsx` for mobile: touchstart/touchmove/touchend with 80px threshold, reveals delete button on left-swipe
- [ ] 6.2 Add vertical movement cancellation (>10px) to prevent swipe-delete from interfering with scroll
- [ ] 6.3 Preserve desktop hover-to-reveal delete button on `history.tsx`
- [ ] 6.4 Implement long-press context menu on `watchlist.tsx` for mobile: 500ms press triggers menu with status change and remove options
- [ ] 6.5 Add movement cancellation (>10px) to prevent long-press from triggering during scroll
- [ ] 6.6 Preserve desktop hover overlay action buttons on `watchlist.tsx`

## 7. Verification

- [ ] 7.1 Run `tsc --noEmit` to verify zero TypeScript errors
- [ ] 7.2 Run `cargo check` to verify zero Rust compilation errors
- [ ] 7.3 Visually verify all pages at 375px viewport width in dev tools
- [ ] 7.4 Visually verify all pages at ≥768px viewport width (desktop layout unchanged)
