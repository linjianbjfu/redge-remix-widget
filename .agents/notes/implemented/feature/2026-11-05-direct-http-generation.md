# Agent Note: 单次 HTTP 生成与固定 360×440 画布

Status: implemented

## 问题

客户端需要提交用户指令、来源 URL、标题、HTML 与可选 PNG，在同一个长 HTTP 请求内取得提取脚本和 Widget HTML。会话创建、上传和 SSE 消费不是这个客户端的交付方式；生成工具和 coding agent 仍需复用。

## 决策

`POST /v1/generate` 接收一次 JSON 请求并等待完成后返回 JSON。Worker 读取 `Date.now()`，以 `tick % 20` 选择 generation-0 至 generation-19，复用现有 DO 类和 AGENT 绑定。此入口不使用 x-webclip-user；同毫秒请求可以落到同一个对象，不将时间分桶当作最小负载调度。

后端不验证 GEC、字段 schema、来源地址、图片或 history；history 不参与模型上下文。路由只复制两个 GEC headers 并设置 JSON Content-Type，不转发调用者的 Authorization/Cookie。失败不返回 Success，正常响应禁止缓存。请求、响应与错误的完整格式由[单次 HTTP 协议](../../../../docs/protocol.md#单次-http-生成)拥有。

每个请求使用 UUID 隔离的临时工作区，复用 pi 模型工厂、会话构造、文件/bash/设计上下文/preview_widget 工具。它不产生持久化 turn 或 SSE 日志；返回或抛错后释放 pi 会话并清理工作区。无需把旧 SSE 当作内部协议解析，也不依赖客户端在线执行工具。

直接入口的 brief、设计参数和预览均使用 fixed 360×440。预览强制使用宿主画布，即使模型 metadata 写了旧尺寸也不改变 viewport。内部继续使用三文件工具流程；响应中的 extractScript/widgetHtml 来自 extra.js/widget.html，title 使用传入 pageTitle。会话入口及三档尺寸继续兼容，不增加 WebSocket。

[预览次数预算](../../implemented/feature/2026-11-06-preview-max-count.md)控制自动检查，默认2，0禁用工具；额度耗尽后完成生成，不增加当前响应的验证状态字段。

### CLI 与 GEC provider

`generate` 可读取请求 JSON，也可复用网页捕获与选区。每次尝试重新取得 provider headers，严格只复制 Sec-MS-GEC 与 Sec-MS-GEC-Version；token 为空白或版本不是 1- 加非空后缀时不发送生成请求。provider 可以是每次运行并输出 JSON 的可执行程序，手动测试也可从环境变量读取；CLI 不实现 GEC 算法。

生成 HTTP 使用 credentials omit、cache no-store，不设置 OAuth Authorization，不携带 Cookie。默认等待 10 分钟，Node 连接池的 headers/body timeout 同步配置，避免仅延长表层 AbortSignal 而仍在默认连接超时处断开。默认不重试；显式 retries 仅针对网络、429 和 5xx，重新取得 provider headers。错误 JSON、无效成功响应和其他 4xx 不重试。超时参数受 Node 定时器有效整数范围限制。

成功响应按客户端规则校验必需文本，对可选字段使用空字符串/0 降级，不增加 size 枚举或尺寸范围限制。成功后保存可供现有 preview 使用的三文件、规范化 response.json 和捕获输入；浏览器模式保留 v2 配对结构，JSON 模式保留原始 HTML。新请求的截图只允许 PNG，超限失败而不回退 JPEG。命令和环境变量由[CLI 文档](../../../../docs/test-cli.md#单次-http-生成)拥有。

### 决策归属

[网页三文件](2026-09-30-static-ios-widget-artifacts.md)、[设计系统](2026-10-06-minimal-widget-design-style.md)、[后端会话架构](../architecture/2026-09-28-backend-architecture.md)、[声明式客户端身份](2026-10-26-client-keychain-identity.md)及[网页工程保留](../simplification/2026-11-05-web-generation-only.md)均只有部分扩展：它们继续拥有三文件、设计规则、旧会话恢复与产品范围，保持活跃并同步事实。没有完全取代的记录需要归档；51 篇既有冻结记录保持原样。

## 曾考虑的替代方案

**在 Worker 内伪造并消费旧 SSE 来收集结果。** 会复制协议解析、制造不需要的持久化事件和恢复语义；直接复用会话及工具更贴合单次请求。

**让客户端创建用户会话或增加 WebSocket。** 不符合给定的一次请求方式，也不符合时间 tick 的 20 DO 路由规则。

**重写生成器为一段纯文本模型调用。** 会丢失已有工具、工作区、设计上下文及预览反馈，不采用。

**删除旧会话接口并全局替换三档尺寸。** 用户要求新增直接 HTTP 支持，没有要求废除现有协议；新入口固定画布，旧入口保留兼容。

## 验证

- `npm run typecheck`、`npm test`、`npm run test:agent`、`npm run test:cli` 分别通过类型检查、145 项后端、9 项真实 SDK、33 项 CLI 测试。
- `npm run test:browser` 的 44 项通过，覆盖 fixed 提取/渲染、标题与来源 query/fragment、PNG 捕获、超限时拒绝 JPEG 回退，以及现有三档和 capture v2 回归。
- `npm run verify-design-system` 检查 6 个模式、8 个组件、10 个样例；文档、Notes 和 diff 检查通过。
- 时钟分桶、并发独立工作区、等待中的响应、成功/失败清理和不验证 GEC 的行为由 [generation.test.ts](../../../../backend/src/generation.test.ts)覆盖。真实 SDK 通过文件和设计工具生成三文件，确认 PNG 编码、来源地址和空历史，不以自造模型结果替代工具接入。
- 分别注入 19 个分桶、转发额外 headers、预览服从旧 metadata、跳过 GEC gating、PNG 回退 JPEG 五个错误，相关门禁均按预期失败，恢复后通过。端口与临时目录由各测试独立分配，子进程和浏览器在 teardown 等待退出。
- 独立本地 Worker 使用真实模型和 Browser Run，从实际 CLI 入口提交一次 JSON 请求，返回 Success、fixed、360×440；本地 Chrome 再渲染正确显示故障数 0 与运行设备 12。证据为 `.playwright-mcp/direct-http-live-LnJQ2F/` 的 result.json、widget.png 与产物。临时 Worker、浏览器和持久化目录已清理。
- 线上服务为 [redge-remix-widget](https://redge-remix-widget.linjsd.workers.dev)，版本 `06dbd7c9-d00e-4362-8ede-a178a3c53a73`，使用独立 DO 命名空间与 Browser Run 绑定。LLM_BASE_URL/LLM_API_KEY 作为该 Worker 的 secrets 同版本上传，仅有这两个 secret，临时密钥文件已删除。公网 GET 入口返回 405/Allow POST/禁止缓存；实际 CLI 的真实模型请求在 76614ms 返回 Success、fixed、360×440，必需文本通过客户端校验。线上产物与结果保存在 `.playwright-mcp/cloudflare-deploy-P6OFhk/`。旧 Worker 与用户本地 server 保持运行。
- Wrangler deploy dry-run 编译成功。旧网关缺少模型上限的核验失败记录保留在 `webclip_widget-bzo`，未通过跳过门禁处理；当前本地三模型定义及核验结果由[Luna 注册](../bug-fix/2026-11-06-luna-model-registration.md)维护，线上版本不自动随本地配置更新。

静态首轮 system 与工具 schema 按 o200k_base 的代理计数从 5228 变为 5150 tokens：system 为 3801→3736，工具为 1427→1414。该测量不包含动态用户输入、图片和后续工具结果，不代表真实请求的总成本。

## 后果

客户端可以通过普通长 HTTP 获得最终代码，不需要会话身份、WebSocket 或 SSE 实现。固定画布将设计与预览统一到 360×440，代价是本入口不提供尺寸选择、多轮历史、幂等或断线恢复。显式重试可能产生新的付费生成。

GEC 不构成后端身份验证，任何可访问入口的调用者都能使用模型额度，这是本次明确给定的接入方式。正常执行清理不等于崩溃清理保证；进程被终止时 finally 可能不执行，不提供已接受请求的恢复或结果补下载。

直接格式没有配对结构快照与区域 XPath，普通 HTML 解析预览不能证明原始实时 DOM 一定一致。现有工具检查仍提供生成反馈，不把 HTTP 2xx 当作提取事实正确性的证明。CLI 的十分钟预算也不改变平台与网络自身的限制。
