## Context

The player page route (`/anime/$id/episode/$ep`) renders a native mpv video view behind the WebView. To make this work, the root layout (`__root.tsx`) sets `document.documentElement.style.backgroundColor = "transparent"` and removes the `bg-background` class from the root `<div>` when on a player page. This makes the entire WebView transparent.

On desktop, the player page has a two-column layout: the player area (left, flex-1) and an inline source/episode selection panel (right, fixed w-80). Currently, the `<aside>` element wrapping the source panel has no opaque background, so it is also transparent — revealing whatever is behind the application window.

Affected route: `/anime/$id/episode/$ep`
Affected component: `src/routes/anime/$id/episode/$ep.tsx` — the `<aside>` element at line ~353.

No backend or Rust crate changes are needed.

## Goals / Non-Goals

**Goals:**
- The inline source panel on desktop must have an opaque background so content behind the app window is not visible through it.
- The player area (left column) must remain transparent so the native mpv view shows through.

**Non-Goals:**
- Changing the mpv rendering pipeline or WebView transparency mechanism.
- Modifying the mobile layout (source panel stacks below the player and already has adequate visual treatment).

## Decisions

**Add `bg-background` to the aside element**

The simplest fix: add the `bg-background` Tailwind class to the `<aside>` in `$ep.tsx`. This uses the existing design token and matches the header bar's background treatment. No new classes or custom CSS needed.

Alternative considered: applying a scoped transparent-only region via a wrapper around just the player area. This is unnecessarily complex since only the aside needs the fix — everything else (header, player area) already has correct backgrounds.

## Risks / Trade-offs

- [Minimal risk] The `bg-background` class resolves to the theme's background color. If themes change, the aside follows automatically — this is desired behavior.
- No migration or rollback concerns; this is a single CSS class addition.
