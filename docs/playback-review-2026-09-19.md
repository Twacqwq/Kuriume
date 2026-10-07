# 播放可用性修复：2026-09-19

> 历史记录：其中前台嵌入播放器、验证码恢复和默认源已由 [2026-10-07 方案](playback-review-2026-10-07.md) 替代。

本轮在 `v1` 的现有工作区中修改，未提交，保留之前的重构内容。此记录取代“目前仍只有一个直链通道”的现状描述，不覆盖 9 月 5 日的历史测试记录。

## 实际根因

1. **正常作品在搜索之前就被拦截。** 桌面 QA 搜索芙莉莲、进入第 1 话，出现 `Alternative titles exceed V1 limits`。AniList 会给很多语言的别名；界面全部传入，而 IPC 只接受 8 个、每个最多 200 个 Unicode 字符。此前只给一个标题的后端测试没有覆盖真实请求。
2. **有线路却被当成无视频。** 当前芙莉莲第 1 话匹配与分集查询成功，但媒体接口返回的是 Mp4、Ok、Uni、Fm-Hls、Sw、Sup 网页播放器，没有旧的 Yt-mp4 直链。旧代码只接受一个固定域名上的 Yt-mp4，其他所有线路被丢弃。
3. **公开服务有限流与人机验证。** 连续跨作品测试后先出现短时限流，再出现 `NEED_CAPTCHA`。不能将这类错误解释成错季或不存在视频，也不能靠无限重试解决。

## 已落地

- 在所有播放源共用的搜索请求构造处去重、过滤过长的可选别名、限制为 8 个。原始标题优先，仍保留 AniList ID、年份和季度匹配；不改成无条件选第一条结果。
- Provider 的解析结果改为**同一作品、同一版本、同一集的一组播放线路**。直链继续交给内置播放器，受支持的网页线路交给 App 内独立 WebView。AGE 的现有解析计划适配到相同契约。
- 播放页可直接切换线路，不用重新搜索作品或重复请求剧集地址。当前播放器失败会依次尝试尚未失败的线路，全部失败才显示错误；不无限循环、不擅自换作品或字幕/配音版本。
- 每条嵌入线路仍受明确域名限制，不向远端授予 Tauri capability，拒绝新窗口和下载。原始嵌入地址留在 Rust 侧，前端拿到的是短期会话标识。
- 对支持 HTML5 媒体事件的嵌入线路，补齐开始播放、进度、结束、错误事件与恢复进度。旧会话的关闭和尺寸更新不能影响新会话；旧播放器错误不能使下一条线路失败。
- 短时限流按照服务端等待时间最多重试一次；长时限制和人机验证不自动重试，显示可辨认的提示。
- 按 Impeccable harden 保持原栗梅色与组件体系，增加紧凑线路选项；已加载的播放器不再保留屏幕阅读器可读的加载提示；嵌入模式全屏保留独立退出按钮，避免被原生子 WebView 遮挡。

## 证据与测试边界

- Rust 工作区库测试：56 项通过，网络/外部 fixture 测试默认忽略。
- Node 回归：12 项通过，包含别名上限、逐条线路回退、嵌入播放器事件与恢复位置、广告域隔离、之前的目录请求取消问题。
- TypeScript、前端构建、桌面 QA 构建与 Clippy `-D warnings` 通过。
- Impeccable 对本轮 UI 文件的静态检测没有发现问题。
- 在线芙莉莲第 1 话 sub/dub：正确匹配，取得 Mp4 嵌入页，HTTP 200。
- **真实桌面播放：** 在隔离的 Kuriume QA 应用中，通过搜索 → 详情 → 第 1 话 → Mp4 播放按钮，看到芙莉莲的视频画面，并收到真实媒体进度。只读检查 QA 数据库确认保存了第 1 话、9.3 秒位置、1560.9 秒时长与对应来源绑定，证明事件也正确到达应用与历史记录。不是仅以 HTTP 200 宣称视频已播放。
- 覆盖矩阵中 Cowboy Bebop、Death Note、SPY x FAMILY Part 2 各自第 3 话 sub、第 5 话 dub，共 6 个组合完成匹配、选集和嵌入页 HTTP 200 检查；这些不是逐一真实播放的证明。
- 随后上游要求人机验证，矩阵没有完整通过；桌面第 3 集及切配音的最终动态验收因此未完成。已停止在线批量请求，没有自动完成或绕过验证码。

## 仍然存在的限制

网页线路的控制条由第三方提供，可能需要用户再点一次播放。媒体事件同步只适用于已声明播放器域中的 HTML5 视频，不保证任意第三方播放器、未来域名迁移和上游服务故障都可用。本轮没有增加 App 内的人机验证工作流，也没有声称恢复了已被上游移除的直链。

## 后续：NEED_CAPTCHA 恢复流程

收到史莱姆第四季第 1 话的新截图后，补齐此前缺失的人工恢复入口；上节“没有验证工作流”描述的是此前一轮，不再是当前代码状态。

- 错误发生在匹配完成后的媒体请求，并不是错季。低频复测时芙莉莲第 1 话 sub/dub 的原生接口已恢复；不能据此承诺上游不会再次要求验证。
- 参考当前 MKissa 公开客户端：其验证码有自己的页面/回调及请求重试，不是简单设置一个 Cookie。专用 `/captcha/turnstile` 页面在当前网络直接返回 Cloudflare 拦截，因此没有做依赖该页面的 Token 复制方案。
- 对 AllAnime 已选定的剧集，错误页提供“验证并继续”。复用 App 内隔离子 WebView 打开**同作品、同版本、同一集**的官网页面，由官网自己处理请求和人机验证；不把用户导向外部播放，不采集验证码答案、Token、Cookie，不授予远端 Tauri capability。
- 脚本只观察官方 `iframe#episode-frame` 挂载。官方页面成功提供播放器后，原生侧再次校验限定的 HTTPS `filelotion.fyi/player.html?id=…` 地址，收起官网页面并切换到播放器。官网的音乐/非播放器视频不会被记成剧集进度。
- 验证时保留本地取消按钮，最多等待 5 分钟；取消、换集、切来源与退出都沿用会话清理。完成官网页面阶段后才重新启用播放器启动超时。
- 查询遇到 `NEED_CAPTCHA` 或限流即停止继续尝试其他标题，不把同一个访问限制当成标题拼写问题反复请求。
- 对照 Cloudflare 官方 WebView 集成要求，验证会话仅额外放行 `about:blank`、`about:srcdoc`，让验证组件可以使用空白子页面；正常媒体会话、其他 scheme、未声明网络域名仍然拒绝。没有修改 User-Agent、复制会话凭证或自动完成验证。
- 按 Impeccable harden 延续现有栗梅色/shadcn 样式，只增加必要的恢复动作与验证期间的状态栏；没有重做整页布局，也没有新增依赖。

### 本次复验

- Rust 库回归 58 项通过，9 项在线/外部 fixture 测试默认忽略；Node 回归 14 项通过；前端构建、桌面构建、Clippy 与 UI 静态检测通过。
- QA 实测史莱姆第四季第 1 话成功取到 Mp4 并加载视频首帧；第 2 话实际持续播放，数据库记录 `position=24.0, duration=1440.1`。首帧与真正播放分开记录。
- 为避免用大量请求制造真实限流，临时 QA 构建将解析错误替换为 `NEED_CAPTCHA`，验证错误入口与官方页面接入。临时替换已从源码还原，交付构建使用真实接口。
- 恢复页面触发官方 Cloudflare 检查；放行验证所需空白子页面后，QA 已显示可操作的“请验证您是真人”复选框。取消验证也实测返回原剧集，关闭对应子 WebView。本次没有代做验证码，因此**人工验证通过后自动接回视频的完整在线验收仍待确认**。本地测试覆盖挂载检测、一次性回报、跨来源/跨集拒绝、原生 URL 二次校验。不能用模拟错误和单元测试宣称真人验证已经通过。

参考：[Kazumi 验证 WebView](https://github.com/Predidit/Kazumi/blob/main/lib/webview/captcha/impl/captcha_webview_inappwebview_impl.dart)、[MKissa 官网](https://mkissa.to/)、[Cloudflare WebView 集成要求](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)。

本轮前后端解析契约一起发生了变化，**需要重启 Tauri 开发进程，仅刷新页面不够**。独立 QA 应用使用 `com.twac.kuriume.qa` 数据目录，不改动日常应用的观看记录。

## 对照来源

- [StreamBert AllManga resolver](https://github.com/truelockmc/streambert/blob/main/src/ipc/allmanga.js)：有多线路尝试、重定向及特定线路处理，不能把一个直链通道的失败等同于作品不可播放。
- [Kazumi WebView source service](https://github.com/Predidit/Kazumi/blob/main/lib/services/video_source/webview_video_source_service.dart) 与 [Apple 实现](https://github.com/Predidit/Kazumi/blob/main/lib/webview/video/impl/video_webview_apple_impl.dart)：以真实播放页加载与媒体观测完成解析，包含取消、超时和跨 frame 处理。
- [MKissa 当前剧集页](https://mkissa.to/anime/ReHMC7TQnch3C6z8j/p-1-sub)：实际查看了当前线路列表与 Mp4 嵌入层，确认这是网页播放器而非可直接交给 ArtPlayer 的 MP4 地址。
