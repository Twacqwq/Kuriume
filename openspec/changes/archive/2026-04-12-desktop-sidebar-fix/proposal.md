## Why

After the mobile-redesign change, the player page (`/anime/$id/episode/$ep`) sets the entire WebView background to transparent so the native mpv view renders through. On desktop, the inline source/episode selection panel (right sidebar) also becomes transparent, exposing whatever is behind the application window (e.g., a browser or desktop). The header bar retains its `bg-background` class so it is unaffected, but the aside panel has no opaque background at all.

Affected platforms: macOS, Windows (desktop layouts). iOS/Android are unaffected because the source panel stacks below the player in mobile layout, and the entire area is scrollable with a dark background.

Affected engine: mpv (the transparency is only applied on player pages to allow the native mpv view to show through).

## What Changes

- Add an opaque background (`bg-background`) to the inline source panel aside on the player page so it is not transparent on desktop.
- Ensure only the player area (left/main column) remains transparent for mpv rendering; all non-player UI regions on the player page have opaque backgrounds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inline-source-selection`: Add requirement that the source panel must have an opaque background on all platforms.

## Impact

- `src/routes/anime/$id/episode/$ep.tsx`: The `<aside>` element wrapping the source panel needs a `bg-background` class.
- No API, dependency, or backend changes required.
