# Agent Note: Admin 用户与原生聊天会话浏览

Status: implemented
Archived: 2026-11-05

## 问题

维护者需要从线上用户进入原生 Widget 聊天历史，查看消息、图片、模型和工具记录及生成源码。用户身份由 x-webclip-user 经 idFromName 路由到用户 DO，既有系统没有可供 Admin 枚举的 UUID 目录。

## 决策

Admin 以 DO object ID 标识用户，直接调用 Cloudflare List Objects API，每次读取 100 条，不建立 D1 用户目录或 UUID 映射。浏览器缓存 8 个已访问的 DO 页，上一页用已访问游标，下一页用上游返回值；刷新重新读取，注销清空私有内容。详情经现有 AGENT 绑定的 idFromString 与 RPC 读取，只展示 purpose=widgee 会话。会话、事件、图片和源码继续由原 DO 拥有。

DO 列表不逐个唤醒对象。服务端过滤 hasStoredData=false 的对象，存储状态未知的对象保留；共享 namespace 中网页专用或仅有 schema 的对象仍可能出现，选中后显示空原生会话列表。过滤不改变上游游标，也不自动补取其它页。DO ID 不代表自然人、安装数或此刻在线，hasStoredData 不代表有原生聊天，不推算注册及最近活跃时间。

会话按创建时间和 ID 排序并使用 keyset 分页，避免仅因续聊更新更新时间就跨页跳动。消息与模型记录按持久化 seq 分页；模型记录列表仅投影关联元数据，完整 pi_entry、图片与源码按需读取。模型调用及工具结果保留 turnId、toolCallId，缺失的请求分类、耗时或用量不补造。图片保留资源引用，不调用会还原全部 base64 的 piEntries 恢复函数。

所有管理数据沿用 Admin 鉴权和 private/no-store，用户 UUID 不能绕过鉴权或改变所选对象。浏览器不执行用户正文及源码；切换对象、登录失效和退出取消在途请求并释放图片 URL。管理读取不主动发消息、运行模型、取消 turn 或修改业务更新时间。现有 DO 构造和 alarm 的恢复、迁移及分析排队仍会发生，不能把唤醒对象描述成没有内部维护副作用。

Cloudflare 读取 Token 只保存在 Worker secret，权限限定到所选账号的 Workers Scripts Read。账号和 namespace 由服务端固定，页面不能指定任意上游地址。Workers 只支持 follow/manual 重定向模式，使用 manual 并拒绝 3xx，避免把 Token 转发到其他地址。配置与完整 HTTP 契约分别由[开发指南](../../../../docs/development.md#用户-do-浏览配置)和[管理会话协议](../../../../docs/widgee-protocol.md#admin-原生会话只读接口)维护。

### 每页 100 条的依据

2026-10-29 生产接口对 limit=10 和 limit=50 均返回 400 / 10077（limit is too low），limit=100 成功。官方文档标注 minimum=10，与该生产接口不同。用户确认每页 100 条，直接匹配可用的上游分页。尾部非空页仍可能带游标，下一页为空且 cursor 为空才结束。

## 曾考虑的替代方案

**建立 D1 用户目录并回填、增量登记。** 可自定义排序和访问时间，但增加索引、写入和重试。直接分页浏览 DO 已满足需求，因此不新增 migration、登记、回填、outbox 或同步 alarm。

**遍历全部 DO，再在内存分页。** 首屏等待和请求数随全集增长。保留上游逐页枚举，页面只缓存访问过的页。

**恢复原始 UUID。** 历史对象缺少完整映射，需要补齐及缺失处理。用户不需要原始 UUID，使用 DO ID 即可导航。

**从 Analytics Engine 查询 DISTINCT 用户。** 采样、保留时间和未上报用户会造成缺口，且没有会话正文，保留其统计用途。

**复制会话、消息和源码到 D1。** 第二份业务数据会增加删除、版本和一致性维护，直接读取拥有数据的 DO。

**上游取 100 条，页面拆成 50 条。** 需要额外的页内位置和游标语义，用户选择统一为每页 100 条。

## 后果

无需客户端升级或新持久化目录，既有对象不需要 UUID 回填。列表依赖 Cloudflare 控制面的可用性、权限及对象可见性；只显示已经产生 DO 的用户，不能恢复删除的会话。上游不提供跨页稳定快照，新增或删除对象时遵循上游顺序。打开详情会唤醒所选 DO。

本期只读，运行中进度通过刷新取得，不提供实时 SSE、代发消息、取消或删除。若未来需要按注册时间、活跃度排序，或需要统计尚未产生 DO 的安装数，应重新讨论目录来源，不能从当前字段推算。

本决策扩展 [Admin URL 导航](2026-10-24-admin-url-navigation.md)，复用 [Admin 登录](2026-10-23-admin-session-login.md)和 [客户端身份](2026-10-26-client-keychain-identity.md)。三篇仍拥有独立决策，没有完全取代或归档。

## 验证

[后端测试](../../../../backend/src/admin/users.test.ts)覆盖固定上游、鉴权、参数、故障和真实 Workers Request 构造；[读取测试](../../../../backend/src/admin/chat-reader.test.ts)覆盖原生范围、搜索转义、分页、旧 SDK、资源隔离、终态及业务时间不变。重定向回归先以 error 模式在 Workers 中失败，再验证 manual 模式通过。前端导航及 LRU 测试与 Admin 构建、类型检查、文档和 Notes 门禁均通过。

[本地 E2E](../../../../test-cli/admin-users-e2e.mjs)接入 npm run e2e:admin，使用独立 Worker/D1/DO 和 Chrome；仅控制平面枚举由[测试入口](../../../../test-cli/admin-users-fixture.ts)提供，生产没有 seed 或枚举替换入口。固定数据为 1001 个对象、用户 A 的 55 个会话及长历史、用户 B 的同名独立会话和不同图片、网页专用及空对象。

| Case | 实际验证 |
|---|---|
| 登录和资源鉴权 | 无凭据的列表、详情、图片、源码和记录请求被拒绝；页面只发送短期 Admin Token |
| DO 翻页 | 1001 个对象遍历十一页，顺序与集合一致，首屏只取一页 |
| 内存缓存和刷新 | 返回命中缓存；超过 8 页后首页重取；刷新重取 |
| 列表滚动 | 点击底部 DO、打开会话及同页返回/刷新保留位置，切换 DO 页或退出后归零；组件回归先复现失败，再验证修复通过 |
| 桌面布局 | 三栏适配窗口高度，每列单一内容滚动区；固定宽度滚动条在 1024、1280、1440 像素视口均无额外页面滚动 |
| 空页与末页 | 空首页、带后续游标的空中间页、无后续游标末页；false 状态过滤、未知状态保留、整页过滤后继续翻页 |
| Cloudflare 故障 | 429、503、403 与网络超时保留当前页，恢复后重试成功，不泄露上游内容 |
| 用户隔离 | 同名会话显示各自内容；跨会话图片、源码和记录返回 404 |
| 原生范围 | 网页专用、空对象显示空列表，历史对象不要求 UUID 映射 |
| 会话搜索与分页 | 55 个会话、sessionId 与特殊字符搜索、清空搜索、详情返回保留列表 |
| 长历史与产物 | 消息分页无重复，输入图片可解码，多个 Widget 源码与按需原始记录可读 |
| 终态及删除 | completed、failed、aborted 可见，删除会话后刷新显示缺失 |
| 迟到请求 | 请求屏障暂停 A，切到 B 或退出后释放，旧内容不能覆盖选择或重新填充页面 |
| URL 与历史 | 刷新、后退/前进、新标签页和窄屏浏览 |
| 登录过期与退出 | access token 刷新、refresh 失效、重新登录及缓存清理 |
| 广场回归 | 未保存内容切换入口时取消/确认、审核、分类、删除、浏览器和服务重启 |
| 真实模型 | 普通聊天接口生成 Widget，Admin 读取已保存消息/工具/源码，摘要及业务时间不变 |
| 线上 Cloudflare | 专用只读 Token、真实枚举、既有会话和源码、鉴权及浏览器详情 |

完整真实模型 E2E 命令为 `ADMIN_E2E_REAL_MODEL=1 npm run e2e:admin`，报告在 `.playwright-mcp/admin-login-Ubz73K/result.json`。补充不同图片和注销在途请求后的固定数据 E2E 报告在 `.playwright-mcp/admin-login-lmukSL/result.json`；该补充运行未执行模型请求，不单独计为真实模型验证。滚动、桌面布局及无存储对象过滤的完整固定数据 E2E 报告在 `.playwright-mcp/admin-login-n2Y7rF/result.json`，未重新调用模型。

[线上只读验收](../../../../test-cli/admin-users-live.mjs)命令为 `ADMIN_USERS_URL=… ADMIN_USERS_OBJECT_ID=… ADMIN_USERS_SESSION_ID=… node test-cli/admin-users-live.mjs`，报告在 `.playwright-mcp/admin-users-live-SYJ0N4/result.json`。实际分页为 22 条、0 条；既有原生会话返回 7 个公开事件、9 条模型记录元数据及 5793 字节 Widget。线上不足两个非空页，这一覆盖缺口由固定数据验证补充，没有制造线上测试用户。所有自建本地服务和浏览器均在结束时关闭。

无存储对象过滤的线上 API 和浏览器验收报告为 `.playwright-mcp/do-filter-live-qQ0zaP/result.json`：返回页数量为 7、0，页面显示 7 个对象，无 hasStoredData=false 条目；该验收只读取列表，不唤醒对象。

线上另有一个历史 DO 在 Admin 读取和原有客户端 ChatStore.list 查询中均报 SQLITE_NOMEM 或内部错误。该对象不计为读取通过，不把失败视为空会话；根因未确定，记录为 Beads webclip_widget-rav，证据为 `.playwright-mcp/admin-users-legacy-do.json`。生产保留明确失败状态，没有修改该对象的数据。线上验收选择已确认有原生会话的对象，不扫描并假定每个历史对象都健康。
