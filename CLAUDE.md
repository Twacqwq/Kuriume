# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Kuriume** is a cross-platform anime aggregation, parsing, and playback app targeting macOS, Windows, and iOS. It lets users stream anime directly from torrents (no waiting for full downloads), upscale with real-time Anime4K, browse metadata from Bangumi, and manage a watchlist/history library.

**Tech stack:**
- **Frontend:** React 19 + TypeScript, TanStack Router (file-based), TanStack Query, Tailwind CSS v4, shadcn/ui (new-york style), Vite 7
- **Backend:** Rust, Tauri v2
- **Task runner:** [`just`](https://github.com/casey/just) (`justfile`) — use `just` instead of npm scripts for most tasks

---

## Build, Lint, and Test Commands

All common tasks are in the `justfile`. Install `just` with `brew install just` / `cargo install just`.

### Setup (first time)

```bash
just setup          # install platform-native deps + npm ci
just bundle-libs    # (macOS/Windows only) collect native dylibs before production build
```

### Development

```bash
just dev            # full dev: Vite frontend + Tauri Rust backend (hot reload)
just dev-frontend   # frontend only (no Rust, faster iteration on UI)
just check          # fast Rust compile check — no linking, just errors
```

### Building

```bash
just build          # production build (run bundle-libs first on macOS/Windows)
```

### Lint & Format

```bash
just lint           # cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
just fmt            # cargo fmt --manifest-path src-tauri/Cargo.toml
```

TypeScript is checked via `tsc` during `vite build`. There is no separate `tsc --noEmit` script — use `npm run build` or check the build output.

### Running Tests

All tests live in the Rust crates. There are no frontend tests currently.

```bash
# Run all Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Run tests for a specific crate
cargo test -p kuriume-provider

# Run a single test by name
cargo test -p kuriume-provider bangumi_provider_name

# Run integration tests for a specific test file (with output)
cargo test -p kuriume-provider --test agedm -- --nocapture
cargo test -p kuriume-provider --test bangumi -- --nocapture
```

> **Note:** Network tests (bangumi, agedm integration tests) require internet access and will call live APIs/sites.

### Clean

```bash
just clean          # rm -rf dist + cargo clean + rm -rf src-tauri/libs
```

---

## Architecture

### Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Frontend  (Vite + React)                            │
│                                                                             │
│  src/routes/          src/components/       src/hooks/       src/lib/       │
│  ┌──────────┐         ┌──────────────┐      ┌──────────┐    ┌───────────┐  │
│  │ /        │         │ ui/ (shadcn) │      │ player   │    │ player.ts │  │
│  │ /search  │         │ Player       │      │ torrent  │    │ torrent.ts│  │
│  │ /calendar│         │ TorrentCard  │      │ online   │    │ store.ts  │  │
│  │ /anime/  │         │ …            │      │ …        │    │ …         │  │
│  │ $id/…    │         └──────────────┘      └──────────┘    └─────┬─────┘  │
│  └──────────┘                                                      │        │
└───────────────────────────────────────────────────────────────────┼────────┘
                                                                     │ invoke() / plugin:mpv|…
                              ┌──────────────────────────────────────▼────────┐
                              │              Tauri v2 IPC Bridge              │
                              └──────────────────────────────────┬────────────┘
                                                                 │
                              ┌──────────────────────────────────▼────────────┐
                              │         src-tauri/src/  (command handlers)    │
                              │                                               │
                              │  commands.rs        ← metadata + torrent src  │
                              │  online_commands.rs ← online scraper          │
                              │  torrent_commands.rs← BitTorrent engine       │
                              │  store_commands.rs  ← settings/watchlist/hist │
                              └──┬───────────┬──────────────┬──────────┬──────┘
                                 │           │              │          │
               ┌─────────────────▼──┐  ┌────▼───────┐  ┌──▼──────────▼──────────────┐
               │  kuriume-provider  │  │kuriume-mpv │  │    kuriume-torrent          │
               │                   │  │            │  │                             │
               │ AnimeProvider trait│  │ MpvPlayer  │  │ TorrentEngine (librqbit)   │
               │ • Bangumi (metadata│  │ GpuRenderer│  │ HTTP streaming server      │
               │   /API)            │  │ PlayerEvent│  │  └─► http://127.0.0.1:…   │
               │ • Mikan  ╮         │  │            │  │      (mpv plays from here) │
               │ • Nyaa   ├torrent  │  └────────────┘  └────────────────────────────┘
               │ • DMHY   ╯ search  │        ▲
               │ • RuleEngine       │        │ tauri-plugin-mpv
               │   (CSS scraper)    │        │ (plugin:mpv| prefix)
               └────────────────────┘        │
                                      ┌──────┴──────────────────────┐
                                      │  src-tauri/plugins/         │
                                      │  tauri-plugin-mpv           │
                                      └─────────────────────────────┘
               ┌────────────────────────────────────────────────────┐
               │               kuriume-store                        │
               │  SQLite (rusqlite): settings · watchlist ·         │
               │  watch history · cache index                       │
               └────────────────────────────────────────────────────┘
```

### Data Flow

1. **Anime browsing:** Frontend calls `invoke("get_list")` / `invoke("search")` → `commands.rs` → `kuriume-provider::Bangumi` → Bangumi API.
2. **Torrent discovery:** Frontend calls `invoke("torrent_source_resolve")` → `kuriume-provider::Mikan/Nyaa/DMHY` scrapes tracker sites.
3. **Torrent streaming:** Frontend calls `invoke("torrent_add")` → `kuriume-torrent::TorrentEngine` (librqbit) starts download → `invoke("torrent_stream_url")` returns a `http://127.0.0.1:…` URL → mpv plays from that stream.
4. **Online sources:** User-configurable CSS-selector rules describe how to scrape streaming sites. The Rust `RuleEngine` handles search + episode-list HTML scraping. Actual video URL extraction happens via a hidden Tauri `WebviewWindow` that intercepts network requests (frontend sniffer).
5. **Playback:** `invoke("plugin:mpv|player_play", { url })` → `tauri-plugin-mpv` → `kuriume-mpv::MpvPlayer` → libmpv renders into a native view overlaid on the Tauri window.
6. **Persistence:** `kuriume-store::Store` uses SQLite for all state: settings, cache index, watchlist, watch history. Accessed via `store_commands.rs`.

---

## Key Directories

| Path | Purpose |
|------|---------|
| `src/` | React + TypeScript frontend |
| `src/routes/` | **File-based routes** — new files here are auto-registered by TanStack Router |
| `src/components/` | React components; `ui/` contains shadcn primitives |
| `src/lib/` | Tauri `invoke()` wrappers + types (mirrors Rust command signatures) |
| `src/hooks/` | Custom React hooks (player, torrent stream, online source, etc.) |
| `src/assets/` | Static assets (images, fonts) |
| `src-tauri/src/` | Tauri entry point + command handler modules |
| `src-tauri/crates/` | Rust library crates (Cargo workspace members) |
| `src-tauri/crates/kuriume-provider/` | Anime data sources and scraping rule engine |
| `src-tauri/crates/kuriume-mpv/` | libmpv2 player wrapper |
| `src-tauri/crates/kuriume-torrent/` | BitTorrent engine + HTTP streaming server |
| `src-tauri/crates/kuriume-store/` | SQLite-backed persistence layer |
| `src-tauri/plugins/tauri-plugin-mpv/` | Tauri v2 plugin bridging frontend ↔ kuriume-mpv |
| `src-tauri/capabilities/` | Tauri permission capability files |
| `scripts/` | Native library bundling scripts (macOS dylib rewriting, Windows DLL, iOS build) |
| `.github/workflows/` | CI/CD: release-please (auto changelog PRs) + build & release |

---

## Routes

| Route | File | Description |
|-------|------|-------------|
| `/` | `src/routes/index.tsx` | Home — anime browse list with hero banner |
| `/search` | `src/routes/search.tsx` | Anime search |
| `/calendar` | `src/routes/calendar.tsx` | Weekly airing calendar |
| `/history` | `src/routes/history.tsx` | Watch history |
| `/watchlist` | `src/routes/watchlist.tsx` | User watchlist |
| `/settings` | `src/routes/settings.tsx` | App settings (player, cache, trackers, Anime4K) |
| `/me` | `src/routes/me.tsx` | User profile |
| `/anime/$id` | `src/routes/anime/$id/index.tsx` | Anime detail (metadata, episodes, torrent sources) |
| `/anime/$id/episode/$ep` | `src/routes/anime/$id/episode/$ep.tsx` | Episode player |

---

## Code Style & Conventions

### Frontend (TypeScript/React)

- **Strict TypeScript** (`strict: true`, `noUnusedLocals`, `noUnusedParameters`).
- Path alias `@/` maps to `src/`. Use it for all internal imports.
- Use `cn()` from `@/lib/utils` to merge Tailwind classes (clsx + tailwind-merge).
- UI primitives live in `src/components/ui/` and are generated/managed by `shadcn`.
- State queries use **TanStack Query** (`useQuery`, `useMutation`). Query client is in `src/lib/query-client.ts`.
- New pages: create a file in `src/routes/` — TanStack Router auto-registers it. Update `routeTree.gen.ts` is done automatically by the Vite plugin during dev/build.
- Tauri calls live in `src/lib/*.ts` — do not call `invoke()` directly in components; use the typed wrappers.

### Backend (Rust)

- **Zero `cargo clippy` warnings** — the CI runs `-- -D warnings`.
- Always run `cargo fmt` before committing.
- New Tauri commands:
  1. Declare with `#[tauri::command]` in the appropriate file under `src-tauri/src/`.
  2. Register in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
  3. Add a typed `invoke()` wrapper in the corresponding `src/lib/*.ts` file.
- Errors are surfaced as `Result<T, String>` at the command boundary; crate-internal code uses typed error enums with `thiserror`.
- Async runtime is Tokio (full features).

### Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add new feature
fix: fix a bug
docs: update documentation
chore: maintenance tasks
refactor: code refactoring
```

---

## Configuration Files

| File | Purpose |
|------|---------|
| `justfile` | Task runner — primary interface for dev/build/lint |
| `package.json` | npm deps; scripts: `dev`, `build`, `preview`, `tauri` |
| `vite.config.ts` | Vite config: React + TanStack Router + Tailwind plugins, port 1420 |
| `tsconfig.json` | TypeScript config: strict, ES2020, `@/` alias |
| `tsconfig.node.json` | TypeScript config for Vite config file |
| `components.json` | shadcn/ui config: new-york style, neutral base, lucide icons |
| `src-tauri/Cargo.toml` | Rust workspace root + main `kuriume` crate |
| `src-tauri/capabilities/default.json` | Tauri IPC permission declarations for the main window |
| `src-tauri/capabilities/sniffer.json` | Tauri IPC permissions for the video sniffer WebView |
| `release-please-config.json` | Automated release/versioning config (syncs versions across all Cargo.toml files) |
| `.release-please-manifest.json` | Current version manifest for release-please |

---

## CI/CD

Two GitHub Actions workflows:

### `release-please.yml`
- Triggers on pushes to `main`.
- Uses [release-please](https://github.com/googleapis/release-please) to auto-create/update a "Release PR" by parsing Conventional Commits.
- When the Release PR is merged, it creates a GitHub Release tag.

### `release.yml`
- Triggers when a GitHub Release is **published** (i.e., when release-please's tag is released).
- Builds and uploads binaries for:
  - **macOS** (`aarch64-apple-darwin`) — installs mpv via Homebrew, bundles dylibs.
  - **Windows** — downloads libmpv via `scripts/bundle-libs-windows.py`.
  - Linux build is present but commented out.
- Requires repository secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

---

## Native Library Setup (Pre-build requirement)

The app embeds libmpv. Before building for distribution you **must** bundle the native libraries:

```bash
# macOS: requires `brew install mpv` first
just bundle-libs          # runs scripts/bundle-libs-macos.sh

# Windows: requires MPV_LIB_DIR env var pointing to mpv.lib
just bundle-libs          # runs scripts/bundle-libs-windows.py

# iOS: separate build scripts
./scripts/build-mpv-ios.sh
./scripts/build-mpv-ios-sim.sh
```

For development (`just dev`), the system-installed mpv (Homebrew) is used directly — `bundle-libs` is not needed.
