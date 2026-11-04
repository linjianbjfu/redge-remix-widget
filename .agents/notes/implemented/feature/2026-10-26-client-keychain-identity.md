# Agent Note: 声明式客户端身份与无共享 token 接入

Status: implemented

## 问题

服务端需要把同一客户端的会话路由到稳定的用户 DO，同时避免向普通客户端分发模型网关密钥。原生客户端的 Keychain 身份与服务端寻址是不同职责；删除 iOS 工程不能改变已有 HTTP 客户端的寻址协议。

## 决策

业务 HTTP 与 SSE 使用 `x-webclip-user`，服务端按该值调用 `idFromName`，不检查共享 AUTH_TOKEN，也不读取 Authorization。标识去除首尾空白后非空且不超过 200 个字符。CLI 使用调用者配置的稳定标识；LLM_API_KEY 只由后端访问。请求、错误与边界由[客户端协议](../../../../docs/protocol.md#认证与寻址)拥有。

标识是客户端声明的路由值，不是登录认证；知道目标标识即可访问对应网页会话。跨部署或换标识不会自动迁移 DO 历史，不能把空列表解释为服务器丢失了原用户记录。当前不增加账号、per-user token 或客户端身份恢复服务。

原 iOS 身份设计以独立 Keychain service/account 原子保存 UUID，采用 AfterFirstUnlockThisDeviceOnly，不做 iCloud 同步。该设计依赖签名团队、Bundle ID 与访问权限：普通卸载不等于身份删除，Keychain 损坏、设备抹除或签名变更也不等于能恢复旧身份。客户端代码和共享资源入口已按[网页生成保留决策](../../implemented/simplification/2026-11-05-web-generation-only.md)移除；本记录保留旧 UUID 所属历史的含义，不宣称当前工程仍提供 Keychain 实现。

此前跨团队迁移只恢复文件，不导入旧 UUID 或其他 Keychain 秘密；原安装与权限相互独立。历史操作证据见[签名与数据迁移快照](../../archived/process/2026-10-30-linjsd-signing-data-migration.md)。旧云端 D1/R2 资源没有因删除本地绑定而被销毁，当前服务不再提供其公开资源或管理入口。

## 曾考虑的替代方案

**把 UUID 放 UserDefaults。** 普通卸载会清除，无法满足原生客户端重装复用的要求。

**Keychain 不可用时临时生成 UUID。** 会将同一设备路由到新 DO，造成历史看似丢失；原方案选择失败时停止请求，不替换身份。

**保留共享 AUTH_TOKEN 或增加账号登录。** 不符合用户明确选择的无客户端 token 接入。重新引入认证需单独定义身份、旧历史归属与迁移，不在删除原生路径时顺带改变。

**要求独立 CDN 才能部署。** 原部署选择默认 Worker 地址；原生公开资源路径已移除，网页 API 和 test CLI 不需要 CDN。

## 验证

[路由测试](../../../../backend/src/router.test.ts)覆盖同用户复用、异用户隔离、空标识、空白、长度边界和未知入口不唤醒 DO。历史 Keychain 卸载重装及真机数据迁移的测试不属于当前工程验收。

## 后果

既有网页客户端继续使用相同地址和标识，无需共享服务 token；这不提供可信的多用户认证或跨设备账号恢复。身份存储由各自客户端负责，服务端不通过轮换网关密钥改变 DO 路由。
