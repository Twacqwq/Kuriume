<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>

<p align="center">
  <img src="src-tauri/icons/icon.png" width="138" />
  <h1 align="center">Kuriume</h1>
  <div align="center">安静、统一的桌面动画发现与播放 App</div>
</p>

Kuriume V1 是一次严格聚焦动画、桌面端优先的重构。AniList 提供目录，独立的播放源负责查找视频，不要求用户配置 API Token。

## 特性

- **动画发现** — AniList 季度目录、搜索、放送日历、详情、选集与角色信息
- **统一应用内播放** — 默认 Anime1，MP4/HLS 统一交给 ArtPlayer，不展示网站或验证码流程
- **匿名播放源** — 播放页按 Anime1 → 稀饭 Next → AGE动漫 → HiAnime 排列；不接入有播放广告、需账号或用户填写密钥的来源，匿名媒体临时 Cookie 仅在播放会话内部使用。
- **声明式来源** — JSON 规则不允许任意 JavaScript；首个内置规则为 AGE动漫
- **本地资料库** — SQLite 保存稳定的媒体 UUID、追番状态、观看历史、续播进度与用户确认的来源绑定
- **Quiet Cinema UI** — 围绕栗梅色 `#904840` 设计的桌面端界面

V1 与旧数据库不兼容，并已移除种子播放、mpv、Anime4K、Tracker 和外部播放器跳转。

## 开发

```bash
npm install
npm run tauri dev
```

常用检查：

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

## 来源边界

Kuriume 不托管视频。社区规则只描述站点搜索和选集结构；作品与季号必须由用户确认。用户应只访问自己依法有权使用的来源。

## 鸣谢

- 应用图标原画由 [ゆきうなぎ](https://www.pixiv.net/artworks/138196800) 创作

## 核心依赖

| 库 | 协议 |
|----|------|
| [Tauri](https://tauri.app/) | MIT / Apache-2.0 |
| [React](https://react.dev/) | MIT |
| [ArtPlayer](https://artplayer.org/) | MIT |
| [hls.js](https://github.com/video-dev/hls.js/) | Apache-2.0 |
| [rusqlite](https://github.com/rusqlite/rusqlite) | MIT |

## 许可证

[GNU 通用公共许可证 v3.0](LICENSE)
