# Agent Note: Wrangler 空 DO 手动清理脚本

Status: implemented

## 问题

用户需要可手动执行的脚本，清理没有任何会话的线上 DO，并可指定一个 DO 清空全部数据。网页会话列表不能证明其他用途的历史记录不存在；读取失败也不能当作空对象。Cloudflare 枚举仍可能返回已清空对象，普通请求会运行构造函数并重新创建表。

Wrangler 4.136.1 不提供单 DO 删除命令。删除须在对象内部执行 storage.deleteAll，不能以删除 Worker 或 namespace 替代。用户要求交付脚本后自行执行，本任务没有执行线上清理或部署。

## 决策

[CLI](../../../../backend/scripts/cleanup-empty-dos.mjs)通过仓库锁定版本的 Wrangler 上传临时维护版本、切换流量、恢复原线上版本。默认预览；只有 --apply 才删除。--id 指定一个对象，明确允许清空其中所有数据，不要求会话为空或可读。完整用法、权限和恢复命令由[开发指南](../../../../docs/development.md#手动清理用户-do)维护。

临时入口在私有临时目录生成，引用当前工作树的后端，不修改产品源文件。入口使用随机凭据、30 分钟有效期和对象白名单，apply 与 forceId 固定在该版本中，HTTP 请求只能选择白名单内的 ID，不能扩大删除权限。日常 src/index.ts 不引用维护模块。

[部署协调器](../../../../backend/scripts/cleanup-empty-dos-core.mjs)在激活前持久化原版本与恢复命令，只接受单版本 100% 流量；已有维护版本、待执行 DO migration 或上传后存储目的地变化都会阻止激活。每个对象操作前检查当前 deployment ID 和 version，发现其它发布停止，恢复时也不覆盖其它发布。版本切换使用仅含 Worker 名和账号的配置，避免同步工作树中的非版本化设置。

普通扫描完整分页枚举对象，每页 100 条，拒绝重复 ID、无效或循环游标。hasStoredData=false 直接记录为已清空，不唤醒。其它对象在 DO 内检查全部 purpose 的 sessions；任意会话、运行中 turn、未知 schema 或读取错误均不删除。指定 ID 模式只操作该 ID，不枚举全集；预览可报告会话不可读，执行不依赖读取会话表成功。

[维护 DO](../../../../backend/src/maintenance/cleanup-do.ts)按需创建正常业务实例，维护检查自身不执行业务 schema 初始化、迁移或 turn 恢复。普通业务和 alarm 请求仍委托给原应用实例；一旦实例处理过这类请求，本轮清理返回 busy，包括指定 ID 模式，避免与未结束的后台工作交叉。没有普通业务访问时，最终检查及原子 deleteAll 在 blockConcurrencyWhile 中执行。删除后验证 SQL 用户表、KV 和 alarm 为空；后续普通请求可正常新建业务实例。

## 曾考虑的替代方案

**直接调用 Wrangler 删除对象。** 当前 CLI 没有单对象删除命令；删除 Worker 或 namespace 超出对象清理范围。

**留下永久清理 HTTP/RPC 入口。** 可省去临时部署，但增加长期管理接口与权限维护。独立维护入口只在手动运行期间激活。

**维护 DO 继承正常 DO 并先运行构造函数。** 会初始化空数据库，且损坏 schema 可能使构造失败，阻止明确指定 ID 的删除。采用按需业务实例，允许指定 ID 跳过会话读取。

**仅隐藏无存储对象。** 改变列表呈现不能清理仍持有 schema 或其它数据的空会话对象，不代替脚本。

**自动扫描将原生会话为空或读取失败视为可删除。** 无法保护旧网页会话及存储异常对象，不采用。指定 ID 则具有不同且显式的全量删除授权。

## 后果

预览也会临时切换生产代码，部署和恢复可能中断正在生成的 turn，需选择安静维护时段。临时运行的是当前工作树后端与临时维护入口，不自动复制线上代码；完成后恢复原版本，恢复版本不恢复已删除的数据。脚本不清理独立 D1／R2 广场数据。

SIGKILL、断电或断网不能保证自动恢复，报告保留准确恢复命令；凭据过期不能代替恢复原版本。版本核对降低并发发布风险，但控制面没有原子条件切换保证，维护期间仍需避免其它发布。failed 或 busy 以及恢复失败均以非零退出码结束；已完成的删除不回滚。

删除不承诺 DO ID 立即从 Cloudflare 枚举消失，也不永久禁止相同客户端重建。普通业务访问可能重新创建表，不以枚举列表立即消失为完成条件。

历史 [Admin 用户会话浏览](../../archived/feature/2026-10-29-admin-user-sessions.md)仅供历史背景；[后端架构](../architecture/2026-09-28-backend-architecture.md)仍拥有部署与运行中 turn 的恢复规则。原生入口与 Admin 已移除；本工具继续保护所有用途的历史存储，见[网页生成保留决策](../../implemented/simplification/2026-11-05-web-generation-only.md)。

## 验证

- npm run test:do-cleanup 的参数、分页、命令适配器、绑定保护、故障与恢复测试通过，并接入根 npm run check。
- 真实本地 DO 测试覆盖两种会话 purpose、空对象、未知 schema、SQL/KV/alarm 删除、运行中对象保护、指定 ID 清空与正常业务恢复；测试位于 [cleanup-do.test.ts](../../../../backend/src/maintenance/cleanup-do.test.ts)。
- [隔离 E2E](../../../../test-cli/do-cleanup-e2e.mjs)通过：本地 Wrangler 真实 HTTP/RPC、持久化 DO、默认预览、批量与指定 ID 清理、不可读会话表、删除后新建会话及普通入口恢复。控制面版本切换由本地 Worker 重启替代，不声称验证了线上发布与恢复。证据为 .playwright-mcp/do-cleanup-e2e-TUWmfj/result.json。
- Wrangler versions upload --dry-run 成功编译实际生成的维护入口，没有上传版本。类型检查、文档及 Notes 门禁通过。
- 真实生产的上传、流量切换、清理和恢复留给用户手动执行，本次未运行。
