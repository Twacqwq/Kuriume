# 播放源收敛：2026-10-07

本次在 `v1` 的现有工作区内实施，未提交。此文取代 9 月记录中的前台嵌入播放器、验证码恢复和 AllAnime 默认源决策；不改动目录数据源、正式版观看记录或其他重构。

## 统一边界

```text
AniList / 本地目录 → 作品与集数
                         ↓
                 PlaybackProvider
                 search / episodes / resolve
                         ↓
         ┌───────────────┴────────────────┐
         │                                │
   HiAnime 专用解析器                AGE 等声明式规则
   公开页面/接口 → 媒体配置            搜索/分集 → 后台页面观测
         │                                │
         └───────────────┬────────────────┘
                         ↓
                 MP4 / HLS + 字幕
                         ↓
               必要时原生媒体代理
                         ↓
              Kuriume 自有 ArtPlayer
```

- 不重复搭建插件系统：复用现有 Provider trait、规则适配器、匹配器与播放状态。
- HiAnime 为新作品的默认源，AGE 保留在播放页；历史记录中仍可用的源优先恢复。后续按用户决定完全移除 AllAnime 的注册、解析器、发布协议发现及专属测试，不再仅隐藏入口。旧记录若引用已移除的源，会回退到 HiAnime 并重新匹配，不复用旧源的作品绑定；观看进度、收藏与数据库保留。
- 不在设置页添加源选项、Token 或实现说明。只有存在多条可选媒体线路时才显示线路选择。
- 目录身份、播放源作品身份和实际视频地址各自独立。Provider 不拥有播放器界面；解析结果只剩 Direct 或后台 Sniff，最终前端资产只有 Direct。
- 后台 WebView 是解析工具，不是播放器或验证码入口。它不显示、不打开新窗口、不下载文件、不拥有主窗口 IPC 权限；30 秒结束。访问验证不自动完成或绕过，解析失败留在本地错误页，用户可换源。

## 调研结论

- [StreamBert AllManga 实现](https://github.com/truelockmc/streambert/blob/4afe564e5ea2565c96d6f2e61679c00fad2d498c/src/ipc/allmanga.js) 仍以 AllAnime API 和特定媒体解析为主；它的其他 Embed provider 不等于“所有源都用自有播放器”，不能据此推导其解决了当前 MKissa 的 `NEED_CAPTCHA`。
- [Kazumi 后台解析服务](https://github.com/Predidit/Kazumi/blob/11671bc0ec61727e99e34810f142a1b5e4121a8e/lib/services/video_source/webview_video_source_service.dart) 与 [Apple 实现](https://github.com/Predidit/Kazumi/blob/11671bc0ec61727e99e34810f142a1b5e4121a8e/lib/webview/video/impl/video_webview_apple_impl.dart) 的关键是后台加载原剧集页、跨 frame 观察媒体，再交回自己的播放器，不是前台铺满网站。
- [ani-cli v5.1](https://github.com/pystardust/ani-cli/releases/tag/v5.1) 已将 anidb 换成 HiAnime。[调研时的实现](https://github.com/pystardust/ani-cli/blob/21ed4a0a6354688622b5a967d93ba96d851d0ef2/ani-cli) 使用 `hianime.at` 与 ZokoAnime。本次依据公开协议独立实现 Rust Provider，没有运行上游 shell 脚本，也没有引入第三方解析服务器或反检测客户端。

## 实际修复

1. HiAnime：搜索结果同时使用英文、罗马字别名；共享保守的季/Part 匹配，不无条件选择第一项。选集保留源的 episode ID 与显式集数，字幕/配音各自限制为已上线集数，不暗中换版本。
2. ZokoAnime：仅解析其公开媒体配置数据，不执行下载来的 JavaScript。只接受声明的 HTTPS 媒体域、HLS 和 VTT；未知服务器/格式报错。
3. HLS 请求头：实测主清单无 Referer 为 403，正常播放器 Referer 为 200。原来的代理只能处理 MP4 Range，本次补齐嵌套清单与 URI 属性重写，分片、字幕沿用站点上下文。所有子资源二次校验域名，保留大小、会话数和资源数上限；不接受任意外部代理 URL。
4. WKWebView：原生 HLS 不使用 Tauri 自定义 scheme，代理 HLS 改由 Hls.js/MediaSource 驱动同一个视频元素，并限定允许其本地 Blob worker。
5. AGE：同站旧 HTTP 链接规范化为规则声明的 HTTPS；重定向不能再被误解析成“空选集”。规则页响应限制 2 MiB；匹配会有界尝试别名。目录已获得的中文名称不会因为 `search_titles` 存在而丢失。
6. 后台解析：加载原始剧集页，初始化脚本覆盖子 frame，不再把第一个 iframe 抽出来顶层加载。只观测媒体，不点击验证或广告。忽略短前贴片、blob 与单个 TS 段；原生侧再读取少量响应验证 HLS/MP4 特征。
7. 移除前台嵌入与验证码恢复组件、桥接命令、脚本及其专用测试。按 Impeccable harden 保留栗梅色、统一选集与简短错误恢复，未重做整页视觉。
8. 字幕按界面语言优先，缺失时回退英文，不再盲选数组第一条（第二集首条实际上是阿拉伯语）。保持远端字幕 HTML 转义，去掉 WebVTT 格式标签的字面显示。

## 验收证据

- HiAnime 芙莉莲第 1、2 集：搜索、选集、主清单与 VTT 真实请求通过。
- 原生媒体代理实测：主清单 → 子清单 → 完整首个 TS 分片通过（885,856 字节）；该项本身不被当作桌面播放证明。
- 独立 `com.twac.kuriume.qa` 构建：芙莉莲第 1、2 集均看到连续视频画面；第 1 集从约 21 秒快进至 46 秒后继续播放，切第 2 集成功。
- QA 数据库只读核实：第 1 集位置 53.3 秒、时长 1559.9 秒；第 2 集位置 19.7 秒、时长 1560.0 秒；来源均为 `builtin:hianime`。
- 最终构建额外验证截图中的史莱姆第四季第 2 集：HiAnime 返回正确的第四季候选，手动确认一次后持续播放至 1:46，时长 24:00，随后暂停。只读 QA 记录也确认来源已变为 `builtin:hianime`。没有以“搜到结果”冒充播放成功，也没有声称这一例实现了免确认自动匹配。
- AGE 在线搜索/选集测试：孤独摇滚返回正确作品，VIP 西瓜与红牛均取得 12 集。
- AGE 桌面验证：芙莉莲可自动匹配并读取 28 集、6 条线路；VIP 西瓜和非凡后台解析超时，最终修正后 VIP 西瓜仍超时。没有收到通过媒体预检的地址，**AGE 实际播放尚未验收通过**，不能把接口接入当作全站可播放。
- Rust 库回归 62 项通过；15 项 Node 回归通过；Clippy `-D warnings`、TypeScript、前端与 macOS QA 构建通过。Impeccable 本轮 UI 静态检测未发现问题。
- 后续移除 AllAnime 后重新验证：49 项 Rust、16 项 Node 回归通过，前端构建和 Clippy 通过。新增断言内置注册表仅包含 HiAnime/AGE，并验证旧 AllAnime 来源回退且不复用其作品绑定。测试数减少来自删除 AllAnime 专属测试；本次没有重新执行线上播放验收。

## 边界

HiAnime 当前适配的是以上入口和 ZokoAnime，不声称支持所有同名镜像或服务器。英文字幕可用不等于提供中文字幕。规则格式沿用项目的声明式 JSON/CSS，不宣称可直接导入任意 Kazumi XPath rule。站点可能换域、限流或失效；有验证要求时不会牺牲本地播放体验去展示网站。

本轮删除的 6 个前台嵌入/验证码实现与专用测试文件此前未被 Git 跟踪，不能通过 `git restore` 直接恢复；没有删除用户数据库、收藏或观看记录。

前后端契约已改变，需重启 Tauri 开发进程；仅热刷新前端不足以载入新 Provider。
