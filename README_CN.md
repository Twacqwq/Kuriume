<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>

<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" alt="Kuriume 图标" />
</p>

<h1 align="center">Kuriume · 栗梅</h1>

<p align="center">动漫聚合、解析和播放应用</p>

<p align="center">
  <a href="https://github.com/Twacqwq/Kuriume/releases/latest"><img src="https://img.shields.io/github/v/release/Twacqwq/Kuriume?color=a4534a&label=%E4%B8%8B%E8%BD%BD" alt="最新版本" /></a>
  <img src="https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-macOS%20%7C%20Windows%20%7C%20Android%20%7C%20iOS-3a201c" alt="平台" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Twacqwq/Kuriume?color=c8a36c" alt="GPL-3.0" /></a>
</p>

<p align="center">
  <img src="docs/screenshots/desktop-home.png" width="100%" alt="Kuriume 桌面端首页" />
</p>

## 这是什么

Kuriume 是一个集动漫与漫画于一体的 App。

做它的初衷，是想把零散的看番环境收拢到一处。平时追一部番，往往要在好几个网站和 App 之间来回切换：一个查新番表，一个找片源，还要另外记着自己看到了第几集。Kuriume 把这些放进同一个安静的界面里，看什么、在哪看、看到哪，都在这里完成。无论在电脑还是手机上，都能用同一种方式专注地追番，把注意力留给作品本身。

不需要注册账号，也不需要做任何设置。你的追番列表和观看记录只保存在自己的设备上。

## 命名由来

<p>
  <img src="https://img.shields.io/badge/%E6%A0%97%E6%A2%85%20Kuriume-%23904840-904840?style=for-the-badge" alt="栗梅 #904840" />
</p>

Kuriume 就是「栗梅」（くりうめ）的读音，一种日本传统色。名字里的梅，一般在冬末早春、百花未开时先开，花语是「高洁」「忠实」「忍耐」。我很喜欢这个颜色，于是把它作为应用的名称和默认主题色。

## 截图

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-detail.png" alt="作品详情" /></td>
    <td width="50%"><img src="docs/screenshots/desktop-player.png" alt="播放" /></td>
  </tr>
  <tr>
    <td align="center">作品详情</td>
    <td align="center">播放</td>
  </tr>
</table>

<table>
  <tr>
    <td width="25%"><img src="docs/screenshots/mobile-home.jpg" alt="首页" /></td>
    <td width="25%"><img src="docs/screenshots/mobile-detail.jpg" alt="作品详情" /></td>
    <td width="25%"><img src="docs/screenshots/mobile-calendar.jpg" alt="放送日历" /></td>
    <td width="25%"><img src="docs/screenshots/mobile-manga.jpg" alt="漫画" /></td>
  </tr>
  <tr>
    <td align="center">首页</td>
    <td align="center">作品详情</td>
    <td align="center">放送日历</td>
    <td align="center">漫画</td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile-player.jpg" width="100%" alt="手机横屏播放" />
  <br />
  <sub>手机横屏播放</sub>
</p>

## 下载

在 [Releases](https://github.com/Twacqwq/Kuriume/releases/latest) 页面下载对应平台的安装包。

| 平台 | 下载 | 说明 |
|------|------|------|
| macOS | `.dmg` | 适用于 Apple 芯片的 Mac |
| Windows | `.exe` 或 `.msi` | 64 位系统 |
| Android | `.apk` | 下载后直接安装 |
| iOS | `.ipa` | 未签名，需要用侧载工具安装 |

## 常见问题

**macOS 提示「无法打开」怎么办？**
Kuriume 暂时没有经过 Apple 公证。先尝试打开一次，然后到「系统设置 › 隐私与安全性」，在页面下方点「仍要打开」即可。

**有的番找不到能播的线路？**
片源来自公开的视频站点，新番刚更新或冷门作品可能暂时没有。可以在播放页换一条线路，或者过段时间再试。

**我的追番记录存在哪里？**
只存在你自己的设备上，Kuriume 没有服务器，也不会上传任何数据。换设备时目前需要重新添加。

## 接下来

- [ ] 弹幕（弹弹play）
- [ ] 漫画阅读：支持 Komga、OPDS 书库和本地漫画

## 参与开发

欢迎提 Issue 和 Pull Request，开发环境和流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 声明

Kuriume 不存储、不上传任何视频，播放内容来自第三方公开站点。请只使用你所在地区依法有权访问的内容。

## 致谢

**数据**
- [AniList](https://anilist.co/) 与 [Bangumi 番组计划](https://bgm.tv/)：作品资料、放送时间与简介
- [soruly/anilist-chinese](https://github.com/soruly/anilist-chinese)：AniList 作品的中文译名

**美术**
- 应用图标原画：[ゆきうなぎ](https://www.pixiv.net/artworks/138196800)（Pixiv）
- 启动壁纸：[Nanami](https://in.pinterest.com/pin/1030128114790424225) (Pinterest)

**画质增强**
- [Anime4K](https://github.com/bloc97/Anime4K) 与 [Anime4K-WebGPU](https://github.com/Anime4KWebBoost/Anime4K-WebGPU)

**字体**
- [Manrope](https://github.com/sharanda/manrope) 与 [Noto Sans SC](https://github.com/notofonts/noto-cjk)

**开源项目**

| 项目 | 协议 | 项目 | 协议 |
|------|------|------|------|
| [Tauri](https://tauri.app/) | MIT / Apache-2.0 | [tokio](https://tokio.rs/) | MIT |
| [React](https://react.dev/) | MIT | [reqwest](https://github.com/seanmonstar/reqwest) | MIT / Apache-2.0 |
| [TanStack](https://tanstack.com/) | MIT | [serde](https://serde.rs/) | MIT / Apache-2.0 |
| [ArtPlayer](https://artplayer.org/) | MIT | [rusqlite](https://github.com/rusqlite/rusqlite) | MIT |
| [hls.js](https://github.com/video-dev/hls.js/) | Apache-2.0 | [scraper](https://github.com/rust-scraper/scraper) | ISC |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | [zhconv](https://github.com/Gowee/zhconv-rs) | GPL-2.0-or-later |
| [Radix UI](https://www.radix-ui.com/) · [shadcn/ui](https://ui.shadcn.com/) | MIT | [uuid](https://github.com/uuid-rs/uuid) | MIT / Apache-2.0 |
| [Lucide](https://lucide.dev/) | ISC | [hyper](https://hyper.rs/) | MIT |
| [Vaul](https://github.com/emilkowalski/vaul) | MIT | [ring](https://github.com/briansmith/ring) | Apache-2.0 + ISC |

Anime4K 与 Anime4K-WebGPU 为 MIT 协议，Manrope 与 Noto Sans SC 为 SIL Open Font License 1.1。

## 许可证

[GNU 通用公共许可证 v3.0](LICENSE)
