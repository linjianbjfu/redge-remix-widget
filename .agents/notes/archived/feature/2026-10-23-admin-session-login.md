# Agent Note: Admin 多设备登录与令牌刷新

Status: implemented
Archived: 2026-11-05

## 问题

Admin 需要通过管理口令登录，在刷新页面和重开浏览器后恢复管理会话，并允许多个设备独立退出。浏览器持续发送根口令无法表达设备会话，也不能单独撤销一次登录。

## 决策

使用随机不透明 access token 和 refresh token，复用 GALLERY_DB 保存摘要与有效期，不引入账号、角色、JWT 签名 secret 或新服务。两种令牌分别使用 32 字节密码学随机数与不同类型前缀，服务端仅保存 SHA-256 摘要；刷新令牌不能访问业务 API。接口字段和 Cookie 契约由 [Widgee 协议](../../../../docs/widgee-protocol.md#widget-广场)维护。

访问令牌有效期 15 分钟，刷新会话自登录起固定 30 天。每次登录创建独立会话；所有会话权限相同，session ID 只标识登录，不能证明操作者身份。每次刷新签发新的访问令牌，旧令牌在自身有效期内继续可用，避免多标签页刷新和丢失响应互相踢下线。刷新令牌不轮换、不续期，页面通过共享 Promise 合并并发刷新，不需要跨标签页锁。

Admin 与 API 由同一 Worker 托管。浏览器只在登录时提交 ADMIN_TOKEN，随后清空输入框；访问令牌只驻留内存，不写入 localStorage 或 sessionStorage。刷新令牌通过 host-only HttpOnly、SameSite=Strict Cookie 返回，不暴露给页面脚本。HTTPS 使用 Secure；HTTP 例外仅由现有本地开发绑定 GALLERY_LOCAL_ASSETS=enabled 开启。三个会话接口要求同源 Origin 与 POST，响应不可缓存；静态登录页公开，投稿数据、图片和源码都通过鉴权请求获取。

### 一致性、撤销与重试

每个管理请求通过 D1 first-primary 读取检查访问令牌与父会话均未过期，不缓存鉴权结果。退出删除当前会话并级联删除访问令牌，后续请求立即失效；其他设备不受影响，已经通过鉴权的在途请求可以完成。刷新通过单条条件 INSERT 再次检查父会话，不能复活已退出会话。数据库故障返回 503，不绕过鉴权。

页面启动时刷新恢复会话。业务请求遇到 401 最多刷新并重试一次；只有鉴权拒绝、业务尚未执行的请求可以自动重放。网络失败与 5xx 不重放审核、删除操作。刷新明确返回 401 时清空数据、详情和图片对象 URL，回到登录页；网络或服务故障显示可重试错误。退出失败保留会话并明确提示，不能宣称服务端已撤销。同浏览器其他标签页在后续请求发现退出。

过期检查不依赖定时任务；现有每小时任务清理过期记录。会话表不进入 Gallery 备份，导入也不覆盖目标环境的登录会话。更换 ADMIN_TOKEN 不会撤销已签发会话，强制全部退出须先清空 admin_sessions 再更换口令，操作步骤见[开发指南](../../../../docs/development.md#widget-广场与-admin)。

### 兼容与决策归属

管理业务 API 同时验证访问令牌与原始 ADMIN_TOKEN，以兼容 iOS 缩略图生产和翻译脚本的显式 --url 模式；客户端 UUID 无管理员权限。Gallery 导入／导出和默认翻译直接访问 D1/R2。会话接口不经过用户 DO。[Keychain 客户端身份](../../implemented/feature/2026-10-26-client-keychain-identity.md)移除普通 App token，不改变这里的管理鉴权。

[Admin URL 导航与刷新恢复](2026-10-24-admin-url-navigation.md)在登录及会话恢复后打开 URL 指定的浏览位置，凭据和鉴权机制继续由本记录拥有。

[广场分享与审核](2026-10-22-widget-gallery-sharing-moderation.md)继续拥有投稿、审核与私有产物决策；[双语生产](../../implemented/feature/2026-10-23-shared-widget-localization.md)继续拥有原生客户端 Keychain 和生产管理调用。本决策只替代浏览器口令持有与登录恢复方式，两篇笔记保持活跃。

## 曾考虑的替代方案

**JWT access token 加 D1 refresh 会话。** 可以省掉访问令牌表，但立即撤销仍要查询会话，并需要维护签名密钥、声明校验和轮换规则。当前管理请求量小，随机令牌和索引查询更容易保持验证及撤销逻辑一致；如果查询成本成为实际瓶颈，再评估 JWT。

**access token 和 refresh token 都放 localStorage。** 接入直观，但会把长期刷新凭据交给页面脚本。Admin 与 API 已同源，HttpOnly Cookie 能恢复登录，页面只需要短期 access token。

**每次刷新都轮换 refresh token。** 能缩短旧凭据的可用窗口并支持重放检测，但多个标签页并发、响应丢失都需要额外协调。首版选择固定 30 天、可撤销的刷新会话；不宣称能够发现被复制的 refresh token。

**直接保存 ADMIN_TOKEN 自动填入。** 能避免重复输入，但不会形成独立设备会话，也无法只退出当前设备的派生凭据，不符合服务端签发两种 token 的目标。

## 后果

每个管理请求增加 D1 索引查询，短期访问令牌需要定时清理。固定 refresh token 被复制后可使用到撤销或到期，不能检测重放；HttpOnly 也不防止恶意页面脚本代表用户发起请求。当前没有设备列表、远程逐设备退出、独立账号、权限分级或设备绑定；会话 ID 保留了后续扩展空间。

原始 ADMIN_TOKEN 兼容入口仍具有完整权限，浏览器退出仅撤销派生会话。移除根口令业务鉴权需要另行迁移原生客户端和脚本，不能把网页登录改造当成所有调用方已迁移。

## 验证

服务端鉴权、路由和 Gallery 聚焦回归共 49 项通过，覆盖伪造／过期／错误类型令牌、跨源调用、HTTPS Cookie 属性、多设备退出、并发刷新、数据库故障与刷新退出竞争。前端请求层 6 项测试验证刷新合并、单次重试、迟到响应、取消及失败退出。真实 D1/R2 备份测试验证导出排除会话、导入保留目标环境会话。

`npm run e2e:admin` 使用真实 Admin、独立本地 Worker、持久化 D1/R2 与 Chrome，通过登录拒绝／成功、图片和源码鉴权、页面与浏览器重开、服务端重启、两设备、多标签页、访问令牌到期、审核写入单次重试、退出撤销与刷新会话到期。截图和无凭据报告保留在 .playwright-mcp/admin-login-3eHya2。测试清理自建服务、浏览器和临时数据；命令说明见 [CLI 文档](../../../../docs/test-cli.md#admin-登录-e2e)。

TypeScript 检查、Admin 构建、文档与笔记门禁通过。验证使用本地 HTTP 开发环境；生产 Secure Cookie 由服务端测试检查，Cloudflare 部署由[Keychain 客户端身份](../../implemented/feature/2026-10-26-client-keychain-identity.md)拥有，尚未执行线上多区域 D1 验证。
