# Agent Note: Luna 模型注册与默认模型切换

Status: implemented

## 问题

用户选择 gpt-6-luna 或 gpt-5.6-luna 时，provider 只有 gpt-6.1-sol 定义。默认模型名称不创建模型定义，会话构造在请求网关前报 not registered，直接 HTTP 将其转为 generation_failed。同一个 key 的三个模型最小文本请求均成功，失败在本地模型查找阶段。

## 决策

provider 中的 GPT 定义为 gpt-6.1-sol、gpt-6-luna、gpt-5.6-luna，保持同一网关、凭据、OpenAI-compatible chat API 与 system 角色约定。[MAI-Code-2-Flash 注册](../feature/2026-11-06-mai-code-2-flash-registration.md)扩展同一个注册表。DEFAULT_MODEL 沿用用户配置，模型选择不由注册逻辑覆盖；未配置时仍回退 Sol。

三者输出上限均为 128000。Sol 与 5.6-luna 上下文为 1050000，6-luna 为 1000000，使用当前网关实际返回的定义，不将 Sol 的上下文值复制给所有模型。注册定义保持推理和文本/图片输入配置；完整真实图片与工具生成由用户验证。

新增 ID 需要明确注册及上限核验；默认名称不作为隐式模型创建入口。模型 runtime 仍按已选择 provider 注册，不要求其他 provider 的 key，也不把模型目录持久化到请求临时文件系统。未知 ID 继续在会话构造时失败。

## 曾考虑的替代方案

**只改 DEFAULT_MODEL 或切换网关。** 默认名称不影响注册集合，当前网关已支持三者，不能修复本地查找失败。

**每个生成请求动态加载整个网关目录。** 会增加网络依赖并引入未知模型兼容性。本次明确支持三个已验证 ID，注册各自已声明的上限。

## 验证

[真实 SDK 回归](../../../../backend/src/agent/model.node.test.mjs)覆盖已注册模型的查找、各自上下文与输出上限、推理和图片配置、实际会话与工具构造、默认值选择、缺少凭据及未知 ID。修改前两个 Luna 的注册断言失败；当前 `npm run test:agent` 的 15 项通过，`npm run verify-model-limits` 确认四项与当前网关匹配；类型、文档、Notes 和 diff 检查通过。

当前本地网关为 cnc.buildnow.work/v1，三个 GPT 模型的最小文本请求均已返回 HTTP 200。完整客户端生成、图片和复杂工具组合不由注册测试替代；线上发布记录由[直接 HTTP 生成](../feature/2026-11-05-direct-http-generation.md)维护，默认模型仍由部署配置选择。

## 后果

选择这三个 ID 时可以进入模型调用，不再因未注册而立即返回 generation_failed。新增模型不改变[直接 HTTP 生成](../feature/2026-11-05-direct-http-generation.md)的工具、画布、输入或响应，也不改变[会话构造与恢复](../architecture/2026-09-28-backend-architecture.md)。这些记录只有部分扩展，保持活跃；取代检查未发现同一注册方案的独立记录需要归档。

网关定义和可用性仍可能变化，核验脚本继续约束上限；注册成功不等于任何输入或模型能力均已验收。线上 Worker 使用其已部署版本与 secrets，本地修改不自动同步到线上。
