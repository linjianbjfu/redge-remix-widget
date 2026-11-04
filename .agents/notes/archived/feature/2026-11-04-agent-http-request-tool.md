# Agent Note: 生成 Widget 前探查外部 API 响应

Status: implemented
Archived: 2026-11-05

## 问题

Widgee 模型能够查询 SDK 的 fetch 契约，但缺少一般外部 API 的请求工具。它可能知道端点地址，却不知道当前响应的嵌套字段、数组、空值或错误格式，因而猜测字段并生成无法正确取数的 Widget。源码结构校验不能发现这类数据解析错误。

用户需要生成阶段的响应证据，客户端继续使用现有 fetch 能力。专用 search_music 已在服务端请求固定供应商，但不适合探查一般 API。

## 决策

[http_request](../../../../backend/src/widgee/http-request.ts)只注册到 Widgee 原生生成器，支持 GET、HEAD 和查询用途的 POST。独立模块负责参数校验、请求及受限响应读取，generationTools 负责注册。参数、返回字段、大小限制和验证命令由[开发指南](../../../../docs/development.md#widgee-api-响应探查)拥有。

模型在外部 API 响应证据不足时先探查，再读取 module:fetch 并生成实际运行代码。完整 JSON 保留原值和类型，非 JSON 文本保留字符串；HTTP 错误保留受限正文，二进制省略、正文截断及超限响应头均有明确标记。模型不能把错误或前缀当作完整成功响应，也不能将样本值写成未来的实时数据。

每次调用只发一次请求，不自动重试、跟随重定向或保存 Cookie。请求和读取正文共享 15 秒预算，并连接当前 turn 的取消信号；结束时释放响应流。[Workers Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/)说明自动跟随重定向会把认证等头转发到不同域名，因此工具返回 3xx，由模型显式决定下一次请求，凭据不会被工具自动带到重定向目标。

响应正文及头是外部数据，不能修改 agent 指令、索取其他凭据或授权新的请求。工具不读取环境密钥、浏览器登录态或设备 Keychain；认证只使用用户为目标 API 明确提供的信息并要求 HTTPS。HTTP 请求只允许少量通用头，自定义头要求 HTTPS；工具不提供自动发现正文或 URL 中所有秘密的保证。

工具复用当前 pi 调用、私有条目持久化和恢复，不增加客户端消息类型、HTTP/SSE 契约、SDK API 或数据库表。参数和响应进入模型及私有历史，不投影为公开工具消息。promptVersion 为 widgee-20，SDK revision 和客户端兼容列表保持独立；已有 Widget 不自动重写。

### 决策归属

[原生聊天](2026-10-19-widgee-widget-chat.md)继续拥有工具执行位置与私有历史，[音乐选曲](2026-11-03-network-music-track-pool.md)继续拥有专用搜索流程，[动态数据直接查询](2026-10-26-widget-live-data-generation.md)继续拥有运行时取数规则。已有 weather、health 等原生 SDK 能力不强制增加 HTTP 探查。

取代检查覆盖工具注册、服务端请求、原生生成和动态数据读取。[内置 skills](2026-11-02-widgee-native-generation-skills.md)中不提供一般 HTTP 工具的限制被本工具部分取代；资源隔离、专用音乐搜索和不提供脚本执行的决策继续成立，记录保留并互链。没有完全取代、归档或删除的活跃笔记。

## 曾考虑的替代方案

**只补提示词，让模型按常见结构生成。** 无法取得真实字段和错误格式，仍需要猜测，不能解决用户描述的问题。

**让客户端代发探查请求。** 依赖手机在线并引入新的执行和回传协议；与服务端生成工具职责和本次客户端不变的要求冲突。

**开放 bash/curl 或浏览器。** 请求场景不需要代码执行、文件系统或网页渲染；专用工具直接返回受限 HTTP 结果，保留原生生成器不提供通用工作区的约束。

**只支持 GET。** 会遗漏使用 POST 查询、GraphQL 或要求 JSON 请求体的 API，因此保留 POST，并明确其查询用途和无法保证无副作用的限制。

**自动跟随重定向。** 减少工具调用，但需要逐跳校验目的地并处理凭据转发；返回可检查的 3xx 保持一次调用对应一次请求。

**完整返回任意响应。** 大数组、HTML 错误页和流式响应会放大上下文和内存开销；默认 16 KiB、最高 64 KiB，截断可见。模型可以提高上限或使用上游分页、字段筛选，不引入响应长期缓存和新的检索存储。

## 后果

模型能够根据实际响应编写字段访问，仍需处理非成功状态、空数据、缺字段和类型变化。服务端出口与手机网络不同，地理限制、IP 风控、鉴权和上游变化仍可能使设备请求失败；探查不证明原生渲染、权限或长期可用性。

URL 校验拒绝显式本地目标和非公网 IP，但不固定域名的 DNS 结果。[Workers DNS 文档](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/)列出 lookup 等未实现接口；另做一次 DNS 查询也不固定 fetch 实际使用的地址。当前不建设独立出站代理或完整私网隔离，不保证消除 DNS 重绑定及所有 SSRF 路径。本地 workerd 的真实出站检查不能代替云端按目标 API 核验；将来接入私网服务时需要重新评估隔离方案。

GET 和 POST 都可能被上游实现为有副作用。工具用于已知数据查询，不提供写入方法或外部请求恰好一次的保证；既有 turn 恢复可能重做尚未持久化结果的请求。HTTP 内容可能被篡改，只能作为外部数据。

响应进入上下文和私有历史，增加 token 与存储成本。超出 64 KiB 的完整响应、二进制、浏览器登录、文件传输、长连接、脚本执行、自动 API 文档发现和客户端网络代理不在当前能力范围。请求模块与客户端 SDK 分开，后续扩展不要求客户端同步实现。

首轮静态 SYSTEM_PROMPT 加工具 name/description/schema 的 o200k_base 代理计数为 11,536 → 11,989，增加 453；其中 system 增加 130、工具 schema 增加 323。不包含技能目录、消息封装或用户输入，也不是网关计费数。

## 验证

本地通过的检查包括：

- `npm test -- src/widgee/http-request.test.ts src/widgee/chat.test.ts src/widgee/session-compatibility.test.ts`：169 项通过。新增工具用例覆盖方法、请求体与头、JSON 各类型、文本、HTTP 错误、二进制省略、输入上下限和非法输入零请求；还覆盖无可信 Content-Length、超长 chunk、中文跨块、精确大小边界、截断、流关闭、取消与超时。
- `npm run test:agent`：12 项通过。真实 Pi 验证请求参数执行、响应进入后续模型调用、重建会话保留工具结果且不重发请求、旧网页工具集隔离；既有生产 runner 图片与会话恢复检查保持通过。
- `npm run e2e:widgee-http -- .playwright-mcp/http-tool-eqy`：隔离本地 Worker 的生产 runChat 使用真实 gpt-6.1-sol，通过嵌套响应、503、计数器和 SDK 天气四个场景。嵌套场景先 http_request 后 submit_widget，原样生成源码实际读取 payload.stations[0].observation.celsius；受控执行替换两个温度值均读取新值，HTTP 失败和空数组不显示旧值。503 场景生成暂无读数状态，并对未确认的成功响应保留不可用状态；计数器与 SDK 天气不调用 http_request。
- 本地 Worker 实际请求 httpbin.org/json，返回 200 和完整 JSON；最新实现另通过 `WIDGEE_HTTP_CASES=live npm run e2e:widgee-http -- .playwright-mcp/http-tool-eqy/live-final` 复核。两次隔离 Worker 均正常停止并删除临时状态，测试会话已清理。
- 类型检查、文档链接、Agent Notes、diff 格式与 E2E 脚本语法检查通过。

工具轨迹、响应、源码、实际模型用量和代理计数证据保存在本地 `.playwright-mcp/http-tool-eqy/`。受控 JavaScript 执行不代表真机原生验证。本次不修改客户端。

## 部署

2026-11-04 生产服务为 https://webclip-widget.linjsd.workers.dev，Worker 版本 `6f797e04-f504-40f7-bc9e-51ad964bb4c1`，deployment `b86eeaef-8bd5-44ad-8dfe-398d8b8a18cb` 承载 100% 流量。版本元数据确认 GALLERY_DB 绑定正式数据库 `037e40e3-77de-42a2-80a4-2702b8f9d833`；远端没有待执行迁移。`npm run deploy` 和技能源／产物门禁通过。

线上隔离身份通过当前生成器创建 Widget。黑盒验收要求模型先请求 GitHub 的实时提交 API，并在回复中写出完整 SHA；独立请求在生成前后取得相同 SHA，模型输出与之逐字匹配，该期望值未提供给模型。生成源码从实际 sha、commit.message 字段取数，不依赖样本值；不可变源码回读的摘要一致，公开广场返回 200。临时测试会话已删除，证据位于 `.playwright-mcp/http-tool-deploy-w1y/`。

生产私有工具轨迹没有单独读取验证：基于 Admin 枚举定位新测试对象的首轮准备未通过，不计为成功验收；黑盒结果证明模型取得了当前 API 数据，与本地真实 Pi 工具轨迹形成不同层次的证据，不声称已检查云端每个工具调用或设备运行。

部署期间 `npm run verify-model-limits` 未通过：网关返回顶层 max_input_tokens/max_output_tokens，现有脚本要求 limits 下的字段。本次未修改模型配置，门禁格式兼容和字段语义确认由 Beads `webclip_widget-hit` 跟进；该失败不计入通过检查。
