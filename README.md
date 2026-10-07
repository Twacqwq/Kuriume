<h4 align="right"><strong>English</strong> | <a href="README_CN.md">简体中文</a></h4>

<p align="center">
  <img src="src-tauri/icons/icon.png" width="138" />
  <h1 align="center">Kuriume</h1>
  <div align="center">A quiet desktop anime discovery and playback app</div>
</p>

Kuriume V1 is a desktop-first rebuild focused strictly on animation. AniList provides the catalog; independent playback providers find media without requiring users to configure API tokens.

## Features

- **Anime discovery** — seasonal lists, search, airing calendar, details, episodes, and characters from AniList
- **Unified in-app playback** — Anime1 is the default; MP4/HLS streams use ArtPlayer, with no foreground website or verification flow
- **Anonymous sources** — Anime1 → Xifan Next → AGE → HiAnime; no account or user-entered key. Short-lived anonymous media cookies stay inside the playback session. Sources with playback ads are excluded from built-in integrations.
- **Declarative sources** — import JSON rules with no arbitrary JavaScript; AGE动漫 is included as the first built-in rule
- **Local library** — stable internal media UUIDs, watching states, history, resume, and confirmed source bindings in SQLite
- **Quiet Cinema UI** — a desktop shell built around the Kuriume (`#904840`) accent color

V1 is intentionally incompatible with the previous database and removes torrent playback, mpv, Anime4K, trackers, and external-player handoff.

## Development

```bash
npm install
npm run tauri dev
```

Useful checks:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

## Source boundary

Kuriume does not host video. Community rules only describe how to search a site and enumerate its episodes. The user must confirm title and season mappings, and is responsible for using sources they are legally allowed to access.

## Thanks

- App icon artwork by [ゆきうなぎ](https://www.pixiv.net/artworks/138196800) on Pixiv

## Core dependencies

| Library | License |
|---------|---------|
| [Tauri](https://tauri.app/) | MIT / Apache-2.0 |
| [React](https://react.dev/) | MIT |
| [ArtPlayer](https://artplayer.org/) | MIT |
| [hls.js](https://github.com/video-dev/hls.js/) | Apache-2.0 |
| [rusqlite](https://github.com/rusqlite/rusqlite) | MIT |

## License

[GNU General Public License v3.0](LICENSE)
