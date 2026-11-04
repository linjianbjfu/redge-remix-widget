# Agent Note: Widget searchImage 图片搜索 API

Status: implemented
Archived: 2026-11-05

## 问题

桌面 Widget 需要按关键词、图片方向和可选颜色获得可显示的图片 URL。图片搜索需要统一封装供应商认证和响应结构，避免每份生成脚本重复实现。用户要求增加 `searchImage(query, orientation, color?)`，直接调用 `api.pexels.com`，默认请求 15 张并随机返回一张，内部 size 默认传 small。

用户提供的本地参考文件 `pexels-image-search.js` 使用 `GET https://api.pexels.com/v1/search`、`Authorization` 请求头和 `photos[].src.original`。脚本当前未纳入 Git，其凭据不写入笔记或生成的 Widget 源码。

## 决策

图片来源优先级与生成脚本的 storage 图片缓存由[图片搜索与缓存提示词](2026-10-30-widget-image-search-cache-guidance.md)拥有；本记录继续拥有 API 契约。

公开全局异步函数 `searchImage(query: string, orientation: 'landscape' | 'portrait' | 'square', color?: string): Promise<string>`，供 `async widget()` 和交互处理器调用，App 中的真实 Widget 预览使用同一实现。

- 去除 query 首尾空白；非字符串或空白字符串拒绝，不发请求。通过 URL 查询参数编码保留中文、空格和特殊字符。
- orientation 必传，只接受 `landscape`、`portrait` 或 `square`，原样传入搜索参数；缺失或非法值拒绝，不发请求。
- color 可省略或传 `undefined`，此时请求不带 color 参数；传入时必须为字符串，去除首尾空白并转小写。接受参考脚本中的 `red`、`orange`、`yellow`、`green`、`turquoise`、`blue`、`violet`、`pink`、`brown`、`black`、`gray`、`white`，以及 `#` 开头的六位十六进制颜色。空字符串、`null` 和其他非法值拒绝；`#` 通过查询参数编码发送。
- 每次调用发送一次官方搜索请求，固定 `per_page=15`、`size=small`，使用默认第一页，不暴露数量、size 或分页参数。参考脚本目前只在显式传 size 时发送该参数；Widget API 按用户要求默认发送 small。
- 从返回结果中提取有效 HTTPS `src.original`，按参考脚本去重，再等概率随机选择一个 URL。不足 15 张时使用实际结果；允许连续调用随机到同一张。
- 返回 URL 字符串，不下载图片、不写 storage、不缓存搜索结果。桌面脚本通过 `await fetch.image(url)` 下载图片，再把返回的本地 uri 传给 `Image({uri})`；Widget 的 Image 渲染器不直接下载 HTTPS URL。
- 无结果、缺少有效 URL、响应结构错误、HTTP 非成功状态、网络错误、超时和取消均拒绝 Promise。错误说明原因，HTTP 错误包含状态码，不包含认证头或响应全文。调用方用现有脚本错误处理显示空状态。

`size=small` 是搜索接口的图片尺寸筛选参数，不是选择 `src.small`；返回值仍取参考脚本使用的 `src.original`。

调用示例：`await searchImage('mountains', 'landscape')`；指定颜色时使用 `await searchImage('flowers', 'portrait', '#ffffff')`。

### 原生实现与凭据

WidgeeBridgeCore 的 FetchModule 提供内部桥接方法，由 JS SDK 的全局 `searchImage` 包装调用。原生层使用可注入的 HTTP 客户端与随机选择函数；生产请求通过 URLSession 直接访问 Pexels，无需主 App 被唤起或服务端中转。禁止跟随搜索接口重定向，与参考脚本一致。

按用户指定，将参考脚本中的 API key 硬编码为原生搜索实现的一处常量，App 与 Widget 扩展共用。不增加构建配置、环境变量或用户填 key 的流程，调用方只传搜索参数。key 不复制到 JS SDK、模型上下文、生成的 Widget 源码或日志。后续若需要更换凭据来源，可替换原生实现中的凭据读取方式，不改变公开函数签名。

搜索请求超时为 5 秒，并服从调用任务取消；现有 WidgetRunner 的整体 8 秒预算保持不变。该预算还包含脚本执行及其他调用，不能承诺每次联网和图片下载都成功。

### SDK 与现有行为

同步 SupportedAPI、类型声明、JS 全局函数、SDK 按需参考、离线 stub 和生成产物，确保模型能发现并正确调用该 API。真实注册表具备搜索能力，离线校验继续不联网。同步 SDK revision 与兼容声明，更新 iOS 设计中的 API 说明；不自动重写已有 Widget。

取代检查未发现仍在活跃树中的 searchImage 或 Pexels 笔记。[原生运行时](../../implemented/feature/2026-10-19-widgee-ios-native-runtime.md)继续拥有 Core 桥接与声明同步规则；[聊天联网预览](../../implemented/feature/2026-10-20-widgee-chat-network-preview.md)继续拥有真实预览与离线校验的区分；[动态数据直接查询](../../implemented/feature/2026-10-26-widget-live-data-generation.md)继续拥有每次刷新查询和系统调度约束。三篇均保留，无需归档或删除。

## 曾考虑的替代方案

**让生成脚本自行调用 fetch 并携带 key。** 会把认证和供应商响应处理复制到每个 Widget，也不能提供用户要求的搜索 API，因此由原生模块封装。

**通过本地构建配置注入 key。** 可以避免将真实值纳入源码，但增加本地和构建环境的配置步骤。用户明确选择先使用参考脚本的 key 硬编码，当前采用一处原生常量。

**由 backend 代理 Pexels。** 能把共享密钥保留在服务端，但新增运行依赖和 HTTP 契约，不符合客户端直接调用 Pexels 的选择。

**没有结果时返回 null。** 会使返回类型变成 `string | null`。采用成功返回 URL、失败拒绝 Promise 的单一契约，让调用方通过 catch 处理。

## 后果

PexelsImageSearch 的真实 URLSession 调用已验证有无 color 两种请求均成功，并能下载返回的原图。早期 Python 探针的 HTTP 403 未在原生调用中复现，不代表原生运行时的实际请求结果。

Pexels 的额度、限流和可用性会影响每次刷新；本方案不自动重试、不翻页、不保证相邻图片不同，也不增加搜索缓存。真机直接下载原图的完整渲染测试出现过 8 秒超时，模型示例因此在消费返回值时追加 Pexels CDN 的 `auto=compress&w=800` 查询参数，下载适合 Widget 的图片；searchImage 返回值保持原图 URL，显示仍受现有预算约束。API 仅返回图片 URL，若供应商对产品要求署名或来源展示，需要核对接入条款并单独确定如何承载这些信息。

硬编码 key 会使凭据存在于原生源码和安装包中，替换 key 需要重新构建并分发客户端；这是当前选择的代价。

## 验证

原生实现位于 [PexelsImageSearch.swift](../../../../ios/Packages/WidgeeBridge/Sources/Core/Modules/PexelsImageSearch.swift)，FetchModule 转发内部桥接调用，JS SDK 提供全局函数。使用严格 JSON 字符串匹配，避免通用 stringValue 将数字和布尔值隐式转换。SupportedAPI、生成声明、服务端 SDK、按需参考和可运行示例同步；模型无需知道 key。

模型首轮 SYSTEM_PROMPT 的 o200k_base 代理计数从 10,339 增至 10,359，增加 20。详细签名和示例按需读取，不常驻首轮。计数不含工具 schema，不代表网关实际计费。Prompt 版本为 widgee-15；新 SDK 兼容读取此前的产物版本。[旧会话续聊](../bug-fix/2026-10-27-widgee-compatible-session-continuation.md)允许旧客户端与旧会话使用当前生成器，不改变客户端的产物读取策略。

已通过的检查：WidgeeBridge 的 PexelsImageSearchTests 13 项（包含真实 Pexels 与图片下载），WidgeeRuntime 的 SearchImageTests 3 项，服务端教材 8 项，聊天与旧 prompt 版本兼容测试 29 项，类型检查、SDK 一致性门禁及 iOS API 门禁。iOS API 门禁包含移除 searchImage 的负例；新增 Swift 文件的 SwiftLint strict 通过。已有 TypeScriptDeclarations 文件用默认 SwiftLint 配置会报既有长度和复杂度问题，未扩大本次范围修改这些规则。

iPhone Air（iOS 27.2）上的 PexelsWidgetTests 使用独立临时存储与真实 Widget 注册表验证搜索、CDN 图片下载、WidgetNodeView 渲染和按钮动作；与 SDKArtifactTests 合计 4 项通过、无跳过。导出的渲染截图已检查，包含真实湖泊照片及按钮。设备证据保留在本地 `.playwright-mcp/search-image/cdn-render-device.xcresult` 与同目录 `cdn-attachments/`。

桌面验收采用用户真机观察与只读快照核对两类证据。用户确认已创建的「海风 · 每日喝水」在桌面刷新时会换图。Agent 从设备 App Group 读取该 Widget 的源码、medium 快照及背景图，确认源码哈希一致，视图尺寸为 366.67 × 172.67pt，包含 406,297 字节的真实海景图片；背景图已查看。快照的 renderedAt 为 2026-10-27 13:29:01（北京时间），refreshAfter 为 13:59:01。读取没有执行源码、请求刷新或改写喝水记录，证据保存在本地 `.playwright-mcp/search-image/home-verification/`。这项桌面验收依赖用户确认刷新换图；Agent 未独立连续记录一次无人操作的系统时间线刷新，不能据此声称验证了系统准时调度。

服务端已于 2026-10-27 部署到 https://webclip-widget.linjsd.workers.dev，Worker 版本为 `9ac7120a-4ce6-4bbe-8ecb-df9b89098cb8`。线上创建临时会话返回 201，SDK 哈希与本地一致、promptVersion 为 widgee-15；会话列表与图库返回 200，删除临时会话返回 204。部署元数据确认 GALLERY_DB 绑定生产数据库。
