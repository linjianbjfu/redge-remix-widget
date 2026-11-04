# Agent Note: 客户端事件上报与 Analytics Engine 指标统计

Status: implemented
Archived: 2026-11-05

## 问题

Widgee 需要统计主 App 活跃、聊天 session 与成功率、Widget 资料库操作、预览质量及广场使用情况。客户端在行为发生时记录事实，统计端定义去重和成功率口径，避免把“每天只上报一次”或图表规则固化在 App 中。

## 决策

主 App → 现有 Worker 的事件接口 → Workers Analytics Engine（WAE）→ Grafana Cloud。实现覆盖 11 类客户端事件；事件范围、指标口径、字段扩展与部署步骤由[分析文档](../../../../docs/analytics/README.md)维护，HTTP 契约由[客户端协议](../../../../docs/protocol.md#事件上报)维护。

客户端事件使用平铺的顶层业务字段，没有 properties 容器。通用列固定，blob10–20、double4–20 由每个事件独立分配；只有确定事件名和 schemaVersion 后才能解释业务列。服务端[注册表](../../../../backend/src/analytics/schema.ts)同时拥有校验、列映射及查询维度。新增字段仍需登记，不接收任意字典。同一事件及版本的列含义不可改写；不兼容变更必须升级版本并处理旧客户端及七天补报窗口。

身份复用[Keychain UUID](../2026-10-26-client-keychain-identity.md)，不改变签名或登录机制。UUID 是安装身份，不是跨设备自然人。该身份记录仍独立拥有其约束；活跃树中没有被本记录取代的旧埋点决策，无须归档其他笔记。

### 传输与观测边界

App 级 actor 持久化事件、发生时版本、原始时间、目标地址、UUID 与重试期限。每次真实前台激活均可记录，传输合批但不限制每日次数。身份读取失败不伪造 UUID，待身份可用后再发送；切换地址不会把旧环境队列送入新环境。429 与指数退避期限跨重启保留，新增事件和重新激活不能绕过它。队列有数量、体积和七天时限，事件不可无限占用磁盘。

Worker 在聊天 DO 转发前处理上报，不启动模型；写入用 binding，手机不持有 Cloudflare Token。完整校验后才写入，202 仅证明调用过 binding，不保证 WAE 已可查询。响应丢失与部分写入后重试可能产生重复，客户端只删除明确接受的事件，统计查询按业务实体去重。WAE 异步写入不提供本方案可用的事务或唯一键，因此链路不是 exactly-once。

这些指标反映客户端观察。App 被杀、长期不再打开或队列丢失时会遗漏服务端已完成操作。恢复的 turn_end 使用事件快照内 session.updatedAt，不能用恢复时间或后来列表返回的最新时间；没有原始时间的旧记录不伪装成今天完成。未来需要全量执行指标时，可增加 source=server 的权威事件，但不能将两种来源直接相加。

生成 completed 不代表一定产出 Widget，hasWidget 只关联同一 turn 的 widget 事件。网络错误不等于生成失败；aborted、cancelled、noop 单列。耗时是同一存活客户端从提交到终态的单调时钟间隔，包含离线与后台等待；恢复后没有起点则未知，不填零，也不称模型耗时。

### 索引、去重与查询

WAE 索引按被统计实体选择：用户、session、turn、操作、render 或 Widget。app.active 另投影激活次数，turn_submitted 另投影活跃 session，created 保存另投影新增 Widget。最多两点/事件，不把投影点数相加当用户事件数。非索引 distinct 的采样准确性有限，不能将所有事件索引都固定为用户。

[查询编译器](../../../../backend/src/analytics/queries.ts)统一使用北京时间自然日，写入时间范围额外覆盖七天补报和五分钟时钟容忍。WAU/MAU 对整个区间去重，不能相加 DAU。普通事件先筛选再去重，使先 cold 后 warm 的用户仍属于 cold 用户；终态先检查状态与日期冲突再筛选，冲突实体从成功率分子、分母同时排除并单列。

耗时先按实体选首次有效测量，再计算观测样本均值或精确分位数；未知值不参与，0 毫秒有效，没有有效样本返回 null。Widget 产出率单列未知产出数，分母为零返回 null。COUNT(DISTINCT index1) 不乘采样权重；MAX(_sample_interval) 仅作诊断，不把产品分析当精确审计。

真实 WAE 当前仅支持一层子查询，不能嵌套查询实现逐层聚合；字符串最早归属用 argMin，未知耗时排序使用同类型数值表达式。查询与生成看板直接在真实 WAE 验证，不能只依赖本地 SQL 模拟。

### Grafana 与权限

采用 Altinity plugin for ClickHouse 的 Server/POST 数据源。专用 Token 仅授予所选 Cloudflare 账号 Account Analytics Read，存于 Grafana 加密配置，不进入 App、看板 JSON、仓库或日志；该权限覆盖账号分析数据，无法限制到单个数据集。Grafana 管理员可编辑只读 SQL，访问由 Grafana 账号权限控制。本项目不新增 Admin 指标页面或管理员埋点。

看板由[生成器](../../../../backend/scripts/analytics-dashboard.mjs)从注册表和查询编译器生成，共 40 个指标面板，分活跃、聊天、资料库操作、预览质量和广场五组。正式与验收看板使用统一的耗时口径筛选，默认平均值，可选 P50/P95/P99，作用于两类有效时长面板，计数与比率不变。日期、App 版本、启动方式、保存来源、预览场景使用业务名称；用户无需知道 blobN。新增事件后重新生成、导入看板，不承诺线上自动发现字段。插件自动追加 FORMAT JSON，生成 SQL 不重复追加。

2026-10-28 实测 Cloudflare Observability 自定义 Dashboard 的 WAE 数据源只提供总计和速率，筛选仅有数据集，查询为 workersAnalyticsEngineAdaptiveGroups 的 count。它不提供 blob/double 业务维度或 UUID 去重，不能替代本看板。新的 Analytics SQL API/query binding 与 WAE SQL API 的命名空间及方言不同；本实现不为查询引入工具链升级。

## 暂缓的指标与桌面 Widget 调研结论


按用户确定的首期范围，以下四类事件暂不实现，也不接入相应字段、聚合、展示或验收：

| 暂缓事件 | 同时暂缓的指标 |
| --- | --- |
| `widget.library_snapshot` | 当前资料库存量、人均拥有量、存量来源分布 |
| `widget.configurations_snapshot` | 系统已配置 Widget 数量、尺寸分布、配置用户占比 |
| `widget.configuration_probe_failed` | 系统配置查询成功率与观测覆盖质量 |
| `gallery.submission_finished` | 投稿提交量、成功率及错误分布 |

资料库保存、删除和广场浏览、添加仍在首期范围；保存到资料库不等于添加到桌面。本期不调用 WidgetCenter 进行配置探测，也不根据 timeline 刷新或 Widget 打开次数推断安装数量。

Apple 的 [WidgetCenter.currentConfigurations()](https://developer.apple.com/documentation/widgetkit/widgetcenter/currentconfigurations())（iOS 18+）可返回本 App 的 `[WidgetInfo]`；回调版从 iOS 14 可用。未来恢复此项时，可过滤本项目的 MiniAppCatalog.widgetKind，统计返回条目及 family。该接口没有实时添加/删除通知，也不提供可靠的主屏幕、Today View、StandBy 位置标签；只能称为“最近观测到的系统配置数量”，不能完整还原累计添加/删除次数。

再次启用前需真机核对同款同尺寸重复添加、叠放和不同位置的返回结果，不能按脚本 ID 去重。WidgetInfo.id 当前类型是 WidgetInfo 自身，不应持久化 hashValue 充当实例 UUID；所选 app.id 为 nil 时 provider 可回退到默认脚本，不能因此忽略该条目。快照查询失败不等于 0，首次观测不等于新添加，乱序补报不能覆盖更新状态；WAE 采样也限制最新快照的完整性。这些调研结论保留供重新评估，不构成本期实现要求。

## 曾考虑的替代方案


**在现有 Admin 中新增指标 API 与看板。** 用户选择 Grafana Cloud，避免本项目维护图表编辑、筛选与展示框架；仅保留受控事件入口、注册定义、查询及可导入看板。

**所有事件共享一份全局业务列映射。** 为 sessionId、renderId、activation 等各自固定位置会让互不相关的事件占满字符串列。采用固定通用列与按事件复用的业务列，查询必须包含事件及版本条件。

**保留 properties 并存储整个 JSON。** properties 作为容器不增加 WAE 可查询列的容量；当前采用的 WAE SQL API 没有官方文档支持的 JSON 路径提取。将明确的业务字段平铺到事件顶层，按注册表映射，避免让调用方误以为任意 key 都能自动存储和查询。

**客户端每天去重后只发一次。** 无法完整保留后续行为、session 和成功率事件，也把业务统计规则固化到 App。采用统一原始事件，客户端只处理传输，服务端定义指标。

**手机直连 Cloudflare 并内置 API Token。** 官方推荐写入入口是 Worker binding；读写管理凭据不应分发到安装包。现有 Worker 能提供受控的事件入口。

**所有事件索引都用 UUID，所有指标直接 DISTINCT 对应 blob。** 适合用户类统计，但官方明确非索引字段的独立值统计可能不准确。按事件的核心统计实体选择索引，后续新指标按需要投影。

**每次投递生成一个随机 index，或直接 COUNT(*)。** 随机投递索引不匹配分析对象，COUNT(*) 会混入重试、历史重放和采样影响。复用业务实体索引，按实际指标去重。

**第一期同时加入数据库唯一键、Queue、每日 Cron 和多套聚合表。** 能提高可靠性及长期保存能力，但不符合轻量客户端上报的首期目标；而数据库记成功与 WAE 写入也不是同一事务，仍需定义失败恢复。保留事件 ID、来源和 schemaVersion，以便将来扩展。

**用客户端事件宣称完整服务端执行成功率。** 客户端无法观察用户离线后所有服务端结果。本期明确观测口径，未来有需要时由服务端补报并区分权威来源。

## 后果

客户端上报与轻量 Worker 写入减少服务端依赖，但接受异步可见、重复及观测遗漏。UUID 格式校验和限流不构成账号认证或反作弊；事件仅含约定 ID、版本、时间、状态和有界错误码，不自动收集正文、源码、图片、健康、位置或脚本 storage。发布时需要同步产品数据使用说明。

WAE 保留三个月，可能采样；本次低流量验收的 maxSampleInterval 为 1，未验证高基数采样精度或负载性能。需要严格完整账本或长期报表时须重新评估可靠存储与导出。日报可保存长期趋势，但不能相加得到月独立用户；补报还要求重算最近七天。

生产与测试使用不同 Worker 和数据集。自动化默认禁用生产上报或显式指定测试 Worker。生产 Worker 已部署，版本为 380fd0d9-c1fa-4a23-8949-f6851dbe82f8；[正式看板](https://happybarley808.grafana.net/d/widgee-events-v1)查询 widgee_events_v1，[验收看板](https://happybarley808.grafana.net/d/widgee-events-e2e)仍使用独立测试数据。带埋点的开发版已覆盖安装到连接的 iPhone Air，原服务设置保留，WAE 查询确认真实 cold 启动事件及独立用户数 1；尚未进行 App Store/TestFlight 发布。权限或 SQL 错误不能显示成零。

写入成本按用户数、人均事件数、投影数和重报系数估算，HTTP 合批不减少写入点数。2026-10-28 官方价格页仍声明暂不计费并给出未来价格；该状态不是永久承诺，发布前应复核账号额度和价格。

## 验证

2026-10-28：Worker analytics 与 router 共 46 项测试通过，覆盖请求边界、列映射、限流、失败响应、查询去重与注入拒绝；typecheck 通过。看板生成器 3 项测试及 verify-docs、verify-notes 通过；实际修改生成 JSON 的负向验收证明文档门禁会拒绝漂移。

iOS 21 项单元/集成检查和 1 项生命周期 UI E2E 通过，无远程测试跳过。覆盖队列重试、恢复与身份隔离、聊天终态重放及 Widget 归属、预览结果与广场采用。原生队列向独立 Worker 上报全部 11 类事件，WAE 查询确认全部事件及 3 类内部投影；真实 App 冷启动和再次前台激活分别产生 cold/warm，同一 UUID 的 DAU 仍为 1。该原生验收使用 iOS 模拟器，未覆盖真机长时间后台或卸载行为。

独立服务端 E2E 验证多用户、跨日补报、重复上报、cold/warm 筛选、冲突状态与日期排除、成功率、取消率、未知耗时及全部 40 个看板 SQL。固定样本终态数为 4、成功率 2/3、取消率 1/4，有效耗时样本 2、P50=100ms/P95=200ms，空版本分母返回 null。Grafana Cloud 数据源 Save & test 成功，云端看板可显示并筛选真实 WAE 验收数据。E2E Worker 不带线上限流绑定，限流拒绝路径由 handler 单元测试覆盖。

本地验收证据保存在 .playwright-mcp/analytics-20261028；服务端与原生检查可按[验证说明](../../../../docs/analytics/README.md#验证)重跑。测试数据依 WAE 保留期过期，不混入生产统计。

2026-10-29：耗时筛选新增回归检查，查询与模板共 12 项测试、typecheck、文档及笔记门禁通过。生产与验收数据集的生成/预览时长均验证平均值和 P50/P95/P99，与去重原始样本计算一致，空版本返回 null；Grafana 两个看板已导入并验证切换。

## 官方资料


以下页面于 2026-10-28 读取，引用结论与方案推断分别在正文说明：

- [Workers Analytics Engine 总览](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Binding、写入 API 与首次建表](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)
- [采样机制与索引选择](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)
- [WAE SQL API、权限及系统列](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
- [COUNT DISTINCT 等聚合函数](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/)
- [SQL 语句、子查询与输出格式](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/statements/)
- [SQL 时区与日期函数](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/date-time-functions/)
- [从 Worker 查询与 secret 配置](https://developers.cloudflare.com/analytics/analytics-engine/worker-querying/)
- [字段限制与三个月保留](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- [价格与当前计费状态](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
- [本地模拟及 remote binding 支持](https://developers.cloudflare.com/workers/development-testing/bindings-per-env/)
- [Wrangler Analytics Engine / Analytics SQL 配置](https://developers.cloudflare.com/workers/wrangler/configuration/#analytics-engine-datasets)

Apple WidgetKit 资料及当前本机 SDK 声明于 2026-10-28 核对：

- [WidgetCenter.currentConfigurations](https://developer.apple.com/documentation/widgetkit/widgetcenter/currentconfigurations())
- [getCurrentConfigurations 回调 API](https://developer.apple.com/documentation/widgetkit/widgetcenter/getcurrentconfigurations(_:))
- [WidgetInfo 与 family/kind](https://developer.apple.com/documentation/widgetkit/widgetinfo)
- [读取 Widget 的 AppIntent 配置](https://developer.apple.com/documentation/widgetkit/widgetinfo/widgetconfigurationintent(of:))
- [WidgetInfo.id 的真实类型](https://developer.apple.com/documentation/widgetkit/widgetinfo/id)
