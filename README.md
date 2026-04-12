<h1 align="center">Kuriume</h1>

<p align="center">
  Cross-platform anime browsing, management, and playback application.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#platforms">Platforms</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#building">Building</a> •
  <a href="#license">License</a>
</p>

---

## Features

- **Anime browsing** — Search, browse, and discover anime with data from Bangumi
- **Dual playback engines**
  - Native **mpv** player for torrent streaming (GPU-accelerated rendering)
  - HTML5 `<video>` player for online sources (HLS/MP4)
- **Torrent streaming** — Search torrents from Mikan / Nyaa / DMHY, stream via librqbit without waiting for full download
- **Online sources** — Rule-engine-based scraping with WebView video URL sniffing
- **Watch management** — Watchlist, watch history with resume, airing calendar
- **Anime4K shaders** — Real-time upscaling via mpv GLSL shaders

## Platforms

| Platform | Status |
|----------|--------|
| macOS    | ✅ Supported |
| Windows  | ✅ Supported |
| iOS      | ✅ Supported |
| Android  | 🚧 Planned |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                      Kuriume                         │
├─────────────────────┬────────────────────────────────┤
│   Frontend (WebView)│      Native Layer (Rust)       │
│                     │                                │
│  React + TanStack   │  ┌─────────────────────────┐  │
│  Router + Query     │  │ kuriume-provider         │  │
│                     │  │ (Bangumi, Mikan, Nyaa…)  │  │
│  Tailwind + shadcn  │  ├─────────────────────────┤  │
│                     │  │ kuriume-mpv              │  │
│  ┌───────────────┐  │  │ (libmpv GPU rendering)   │  │
│  │ Video overlay │──┼──├─────────────────────────┤  │
│  │ (transparent) │  │  │ kuriume-torrent          │  │
│  └───────────────┘  │  │ (librqbit + HTTP stream) │  │
│                     │  ├─────────────────────────┤  │
│  invoke() ──────────┼─▶│ kuriume-store            │  │
│                     │  │ (SQLite persistence)     │  │
│                     │  └─────────────────────────┘  │
├─────────────────────┴────────────────────────────────┤
│                  Tauri v2 (IPC)                      │
└──────────────────────────────────────────────────────┘
```

## Tech Stack

**Frontend**: React 19, TypeScript, Vite, TanStack Router & Query, Tailwind CSS v4, shadcn/ui

**Backend**: Rust, Tauri v2

**Playback**: libmpv (OpenGL/Metal GPU rendering), FFmpeg

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://rustup.rs/) (stable)
- [just](https://github.com/casey/just) (task runner)
- Platform-specific dependencies (see below)

### Setup

```bash
# Clone the repository
git clone https://github.com/Kuriume/Kuriume.git
cd Kuriume

# Install all dependencies (npm + platform-native)
just setup

# macOS only: bundle native libraries for distribution
just bundle-libs
```

#### macOS

```bash
brew install mpv
```

#### Linux

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libmpv-dev
```

#### Windows

Download libmpv from [mpv-player-windows](https://sourceforge.net/projects/mpv-player-windows/files/libmpv/) and set `MPV_LIB_DIR` to the directory containing `mpv.lib`.

### Development

```bash
# Full dev environment (Vite + Tauri)
just dev

# Frontend only
just dev-frontend
```

## Building

```bash
# Production build
just build

# Lint & format
just lint
just fmt
```

## Project Structure

```
src/                    # Frontend (React + TypeScript)
  routes/               # File-based routes (TanStack Router)
  components/           # UI components
  hooks/                # Custom hooks
  lib/                  # Utilities & state
src-tauri/              # Backend (Rust + Tauri)
  src/                  # Tauri commands
  crates/
    kuriume-provider/   # Anime data sources (Bangumi, scrapers)
    kuriume-mpv/        # libmpv wrapper & GPU render pipeline
    kuriume-torrent/    # Torrent engine & HTTP streaming
    kuriume-store/      # SQLite persistence
  plugins/
    tauri-plugin-mpv/   # Tauri ↔ mpv bridge
  resources/shaders/    # Anime4K GLSL shaders
```

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

### Third-Party Licenses

Kuriume depends on the following copyleft-licensed libraries:

| Library | License | Usage |
|---------|---------|-------|
| [mpv](https://mpv.io/) | GPLv2+ | Video playback engine |
| [FFmpeg](https://ffmpeg.org/) (libavcodec, libavformat, libavfilter, libavutil, libswscale, libswresample) | LGPLv2.1+ | Audio/video codec & demuxing |
| [x264](https://www.videolan.org/developers/x264.html) | GPLv2 | H.264 encoding |
| [x265](https://www.videolan.org/developers/x265.html) | GPLv2 | H.265/HEVC encoding |
| [libbluray](https://www.videolan.org/developers/libbluray.html) | LGPLv2.1+ | Blu-ray playback |

Full dependency licenses can be found in the respective upstream repositories.

### Icon

App icon artwork by [ゆきうなぎ](https://www.pixiv.net/artworks/138196800) on Pixiv.
