# Agent Note: 仅保留网页生成与 test CLI

Status: implemented

## 问题

网页转换和 Widgee 原生 Widget 生成使用不同的产物、工具及客户端运行环境，却共用 Worker、用户 DO、SQLite、模型配置和 pi 会话构造。用户选择只保留网页生成与 test CLI；保留原生附属模块会继续承担 Swift SDK、广场、审核与原生统计的维护成本，直接删除整个 backend 则会丢失网页能力。

## 决策

工程提供网页捕获、区域选择、结构快照、多模态输入、服务端生成与预览，以及 test CLI 下载和本地预览。交付仍是 `widget.html`、`extra.js`、`meta.json`；提取脚本名称是 `extra.js`。网页 brief、模型注册表和会话工厂与本次删除前的备份逐字节一致。

删除完整 `ios/`、后端原生生成模块与产品 skills、原生 SDK 派生工具、Widget 广场、Admin、App 与原生 Token 统计，以及各自的测试、E2E、文档和配置。共享 DO 只执行网页 runner，不创建原生、同步或统计专用表；Worker 只转发 `/v1/sessions` 及其子路径，其他入口返回 404 且不唤醒 DO。

保留网页 agent、设计系统、提取与渲染、工作区、shell、Store/Hub/SSE 和 alarm。共享构造无需复制到新项目，也不需要为删除原生功能重写网页生成器。通用手动 DO 维护工具仍可使用，上传临时入口不再构建 Admin；它检查全部用途的历史会话，不能把网页列表为空当作可删除证据。

Wrangler 保留 AGENT、Browser Run、模型配置、原 Worker 名称、DO 类和既有 migration 标识。D1/R2、静态 Admin、统计和 cron 绑定已移除。Worker 类型使用 `.dev.vars.example` 生成，避免个人配置中的额外变量进入生成文件；实际凭据文件保持原状。移除原生源码解析所用的直接 acorn 依赖，lockfile 保留其他消费者需要的传递依赖和原版本。

### 存量数据库

保留最小的 `purpose='webclip'` 判别，无用途旧网页记录默认归类为 webclip。列表、按 ID 访问、发送、订阅、中止、删除、运行中判断、恢复及过期 turn 清理都限制为网页会话。已有非网页记录、额外表和额外列保持静置；原生进行中 turn 不进入网页 runner，不会持续续排网页 alarm。

本次不做 DROP、清库、数据转换或云资源销毁，也不部署。解绑本地 D1/R2 不会删除 Cloudflare 数据。本地 `backend/shared-widgets-data` 导出包完整移到备份目录，避免把用户数据当作源码丢弃。历史用途与声明式身份的含义分别由[原生会话隔离](../feature/2026-10-19-widgee-widget-chat.md)和[客户端身份](../feature/2026-10-26-client-keychain-identity.md)保留。

### Agent Notes

51 篇仅约束已移除原生、广场、Admin、统计和签名实现的实质性记录归档，正文与删除前备份完全一致，只增加 Archived 元数据，哈希已封存。两篇局部 UI 记录直接删除：稳定底部导航、广场分类列表与尺寸角标。八篇原生待实施提案因产品路径移除而失效，其方案不再构成当前工程中有诱惑力的替代方案，删除记录及活跃入链。

网页三文件、运行时 data.json、捕获、设计、预览与 CLI 决策继续活跃；标题含 iOS 不代表归属原生生成。共享 SSE 心跳、历史用途隔离、无共享 token 寻址和 DO 维护仍指导当前代码，保持活跃并更新事实。归档文件的出链是历史快照，不作为当前使用说明。

## 曾考虑的替代方案

**只删 iOS 与原生生成目录。** 路由、DO、广场、Admin、统计、构建脚本和 CLI 检查仍依赖这些模块，会留下失效入口和不可构建的工程。

**把广场、Admin 和统计保留给网页使用。** 当前数据模型和产物属于原生 Widget。移植它们是新增能力，保留原状则继续维护用户要求删除的产品路径，故一并移除。

**清空历史后移除 purpose。** 会扩大到用户数据与线上维护；不清数据却去掉判别会将原生历史暴露给网页 API 或恢复器。选择最小隔离，不保留原生运行能力。

**复制网页逻辑到新项目再替换。** 会复制依赖、配置和工作流，也难以证明行为保持一致。在原工程删除专用模块更容易保留网页语义。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npm run types`、`npm run typecheck` | 类型生成与检查通过。 |
| `npm test` | 最终 22 个文件、138 项测试通过。 |
| `npm run test:do-cleanup` | 14 项通过。 |
| `npm run test:cli` | 24 项通过。 |
| `npm run test:agent` | 6 项真实 pi SDK 接入测试通过。 |
| `npm run test:browser` | 42 项真实 Chrome 测试通过。 |
| `npm run e2e:do-cleanup` | 独立 Worker 的预览、全部用途保护、显式删除、普通业务恢复与入口撤回通过。 |
| `npm run verify-design-system` | 6 个模式、8 个组件、10 个样例通过。 |
| `npm run verify-docs`、`npm run verify-notes` | 文档链接、分类、格式和 51 篇封存哈希通过。 |
| `npx wrangler deploy --config backend/wrangler.jsonc --dry-run --outdir /tmp/webclip-web-only-bundle` | 实际 Worker 构建通过，没有上传或部署。 |

存量隔离回归位于 [web-only.test.ts](../../../../backend/src/do/web-only.test.ts)。分别移除未知路由拦截、会话用途过滤、历史 turn 过滤，或恢复原生表初始化时，相关测试按预期失败；恢复实现后通过。新门禁进入默认 `npm test`，由顶层 `check` 调用。

既有 5 MB 文件测试使用数组深比较，单独运行耗时约 4.08 秒，全量复跑曾以约 5.58 秒超过原 5 秒上限。断言改为 Buffer.compare 的等价逐字节比较，保留数据量和超时；在分块边界翻转一个字节时，断言以值不等失败，未发生超时。最终全量测试总用例耗时约 2.06 秒。这只改变比较实现，不改变测试策略或减少验证字节数。

独立本地 Worker 使用真实模型和 Browser Run，从固定网页生成 small widget；实际 CLI 创建会话，test CLI 接收并保存三文件，本地 Chrome 再渲染通过，故障数 `0` 正确显示。历史 SSE 仍只有产物 metadata。证据为 `.playwright-mcp/web-only-live-dps4R9/result.json`、`widget.png` 和生成产物；维护 E2E 证据为 `.playwright-mcp/do-cleanup-e2e-zwHn91/result.json`。任务启动的 Worker、浏览器及临时持久化目录均已退出或清理。

`npm run check` 在模型上限核验处失败：网关未声明 gpt-6.1-sol 的 contextWindow 和 maxTokens。模型注册表和核验脚本与备份一致，真实生成已通过；没有修改上限或跳过门禁。独立问题为 Beads `webclip_widget-bzo`，不能将顶层 check 报为通过。未重跑完整设计模型评测、线上保活驱逐或全部五个真实模型尺寸案例；三档渲染由浏览器回归覆盖，真实模型本次覆盖 small 样例。

## 后果

工程不再提供原生 App、原生生成、广场、审核与原生统计。网页的三文件、尺寸、静态渲染、SSE、下载及既有取消和历史补下载限制保持不变；没有新增网页广场、账号体系或统计。

重新引入原生产品需独立方案，明确 SDK、原生验证、旧版本恢复、发布与权限；不能将 dormant 原生记录直接交给网页 runner。显式数据清理也需要单独授权，不能以源码删除隐含销毁存量资源。

删除前源码没有 Git 历史可供回滚，独立备份在 `/Users/jian/project/webclip-web-only-backup-7mks__qc/source-before-removal.tar.gz`，旁有 SHA-256 清单、变更清单、Notes 分类记录及原广场导出包；不含实际凭据和 `.beads`。工程使用本地 Git 保存网页代码，远端指向用户指定的 [redge-remix-widget](https://github.com/linjianbjfu/redge-remix-widget)。实际凭据、缓存、任务数据库和验收产物排除在版本控制之外。
