# Agent Note: 服务端模型 Token 用量与生成耗时统计

Status: implemented
Archived: 2026-11-05

## 问题

客户端事件不能完整观察工具循环、压缩、重试和用户离线后的模型调用。运营需要按用户、session、turn、request 查看 Token、模型请求类型与耗时，并关联工具的生产请求、实际执行和消费请求。

## 决策

看板展示由[整体汇总](2026-10-29-token-dashboard-overview.md)拥有；采集、身份与可靠性决策保持有效。

只在 App Widget 聊天 runChat 创建的 runtime 实例上装饰 streamSimple 和工具 execute。共享模型工厂、session 构造与网页 runTurn 不接入采集器。只统计 Token，不计算金额，不回填历史用量，不上传提示词、回复、参数、结果或 Widget 源码。

采用四种私有服务端事件：request 最终用量、turn 业务终态、工具执行及 consumer/工具结果关联。客户端上报入口拒绝这些事件。字段、枚举、时间口径、队列边界与看板用法由[服务端 Token 文档](../../../../docs/analytics/server-tokens.md)拥有；[客户端事件分析](2026-10-28-client-event-analytics.md)仍拥有安装身份、客户端事件和只读 Grafana 权限决策。

每次 SDK stream 调用前持久保存新 requestId，应用层重试产生新 ID，投递重试复用原 ID。仅观察最终累计 usage，避免 completeSimple 与中间 chunk 重复计数；SDK 内部 HTTP 重试不可独立观察。旧 attempt 迟到的 usage 仍计入真实消耗，不受业务输出失效条件影响。

请求类型、重试原因和返回形态独立，开始时冻结分类。压缩优先于普通生成，前置压缩不占 initial 位置；工具续推只关联本 attempt 的新结果，重试可以复用关联。生产响应中的重复 toolCallId 不能推断唯一归属，明确标为不完整。

Session 耗时按已结束 turn 的完整处理时长求和，不含用户聊天间隔。LLM 调用、工具整体调用和 execute 耗时分别测量；并行累计不可视为墙钟时间。取消后的迟到 usage 不延长已冻结 turn 时长。删除进行中的会话前保留 aborted 统计，私有队列不被聊天外键级联删除。

统计写入失败不改变聊天结果、不触发模型重试。私有 SQLite 有界队列支持冻结、恢复、中断标记和重投；alarm 与生成 keepalive 取最早时间。WAE 查询按身份去重、排除冲突后再过滤，不能对各列独立取 MAX 拼接实体。工具关联复制 consumer 用量以支持 WAE 单层子查询；总体只从 request 事实求和，多工具合并选择按 consumer 再去重，各工具组不可直接相加。

WAE 的采样和异步可见性决定看板提供观测值，不能承诺精确账本。maxSampleInterval 和缺失/冲突/关联完整性显式展示，未知用量不算零。列表限行与顶部完整范围汇总分别查询；请求级条件不将整轮耗时归因给单一工具或模型。时间窗口始终继承，三个月以外不宣称完整生命周期用量。

## 曾考虑的替代方案


**为普通续推保留 continuation 分类。** 当前 runChat 没有可确认的独立普通续写入口；本期只使用 initial、tool_followup、compaction、unknown，不为未来能力预设一个没有实际触发的类型。

**把工具名列表塞进一个 JSON 字符串并直接筛选。** 当前 WAE 查询不依赖 JSON 路径提取；只存单一 toolName 又丢失多结果关系。选择独立关联投影，支持精确工具筛选并保留多对多关联，接受额外写入点和去重规则。

**只用 tool_execution_start/end 作为实际执行时长。** SDK 对未执行工具也产生这些事件，并行预检还会包含执行前等待。保留 SDK 调用整体时长，同时包装本次 App 工具实例的 execute 测量实际执行时长，不修改工具定义契约。

**将重试、工具调用和压缩塞进同一个互斥类型。** 压缩可以重试，工具续推也可以重试；同一调用的原因与返回形态也不同。采用 requestType/retryKind/responseType，只有 request 事实参与 Token 求和。

**用 session 首末活动差值代表生成耗时。** 同一会话可隔日续聊，时间差包含大量用户间隔。按用户确认采用累计 turn 处理耗时，不采集或展示活动跨度；LLM 调用耗时另外统计。

**只在 chat.turn_finished 汇总。** 依赖业务最终成功落地，会遗漏中断、旧 attempt、压缩或部分失败；历史恢复还可能重复累计。选择 SDK 调用为事实单位，turn 只作分组。

**只扫描已有 pi_entry 或使用 getContextUsage。** 后者表示上下文占用，不是累计用量；历史日志可能缺少被中断的调用或摘要细节。首期从新调用采集，不自动回填旧会话，避免把不完整历史当完整消耗。

**SDK usage.cost 或价格表换算金额。** 用户明确只要 Token；当前配置单价为零也不代表没有实际费用，本期不引入金额字段。

**完成回调直接写 WAE，不保留本地记录。** 最简单，但写入异常、DO 回收和重复回调难以恢复或定位。采用现有 SQLite 的有界私有表，换取可重试和中断可见性，接受额外写入及 alarm 维护成本。

**本期同时建设精确账本、网关扣费接口或全量原始响应拦截。** 超出 Token 产品分析需求，也会引入新的协议、存储和凭据维护。当前保留 requestId、用量状态和版本，后续可以扩展；不为精确采集改变 provider 重试或复制 SDK 解析器。

**将当前按事件复用的列改成全局固定 Token 列。** 没有必要；新事件可独立分配 double4 之后的字段，保留全部客户端事件语义。

## 后果

采集覆盖 App 聊天中的模型循环、压缩和重试，无需客户端升级。生产 Worker 已部署，版本为 1ad683f3-4fc6-4f2a-bf61-95fb9acdef8c；[正式 Token 看板](https://happybarley808.grafana.net/d/widgee-token-usage)连接 widgee_events_v1，并复用原只读分析数据源。新调用开始积累用量，现有 E2E 看板保留隔离数据。

队列最多七天、10,000 行和 10 MiB，先淘汰已投递项；仍可能丢失超限未发事件。WAE binding 成功不是逐条持久化确认，DO 在结果到达前回收也无法恢复未返回的用量。严格审计总量需另建精确存储；需要其他 workload 时应显式接入，不能扩大共享模型工厂的默认副作用。

真实 WAE 验证确认 IF 分支需要一致数值类型、SELECT DISTINCT 不支持、含单引号或反斜杠的字符串字面量不可用。看板变量使用 GROUP BY，显示原始 ID、以 hex 值筛选；Grafana 自定义 All 值绕过 sqlstring 格式化，故使用完整 SQL 字符串字面量，并通过 queryparam 继承 URL 筛选。

## 验证

2026-10-29 生产部署验证：独立测试身份从正式 App messages 入口完成一次真实 Widget 生成，生产 WAE 记录三次模型请求、38,502 Token、一次完成轮次，以及 get_widgee_reference、set_session_title、submit_widget 的工具耗时和结果关联。未向生产重放合成事件，证据见[生产验证记录](../../../../docs/analytics/token-production-evidence.json)。部署前后共 168 项模块/DO 测试、真实 SDK 工具循环测试、typecheck 和 SDK 一致性检查通过。

单元与 DO 集成覆盖 usage 归一化、分类、重试、压缩、同步/异步工具、取消、迟到、失败隔离、身份恢复、终态幂等、会话删除、容量/保留期、投递批次与 alarm 共存。真实 SDK 的本地 HTTP 模型夹具验证 stream、同名工具、工具续推和手动压缩，防止只测试自造事件。

隔离 Worker 的真实 App messages 生成产生四次模型请求，SDK 与 WAE 总量均为 51,882 Token。固定样例有五个请求，总量 4,950；其中 Session A 为 4,900 Token、两轮累计 15 秒。三份工具结果对应两种工具，合并筛选 consumer 为 300 Token，重复投递不增加总量。真实 SQL 还验证模型/用量/日期冲突排除及含引号、反斜杠、中文的会话 ID 精确匹配。

[Grafana E2E 看板](https://happybarley808.grafana.net/d/widgee-token-e2e)使用隔离数据集。可重复脚本验证 查询编译器、实际面板和变量 SQL，以及汇总/工具/空数据筛选；证据见[验收记录](../../../../docs/analytics/token-e2e-evidence.json)。E2E 为对抗采样重投相同冻结点，这验证幂等查询，不证明生产采样无丢失。
