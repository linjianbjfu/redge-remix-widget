# Agent Note: MAI-Code-2-Flash 本地注册

Status: implemented

## 问题

用户需要选择 mai-code-2-flash。默认名称不会创建模型定义，必须注册实际限制和能力，使现有 coding agent 能查到该模型。

## 决策

当前 provider 注册 mai-code-2-flash，显示名为 MAI-Code-2-Flash。上下文 1050000、输出 128000、文本/图片输入及推理能力来自当前网关目录声明。保持现有 chat 兼容 API、system 角色约定与其他模型配置，DEFAULT_MODEL 沿用用户选择，未配置时仍回退 Sol。

网关目录标记原生 Responses endpoint，但实际 /chat/completions 兼容入口已通过验证；不为新增模型切换整个 provider API。新增 ID 的显式注册、默认选择和上限核验继续由[Luna 注册规则](../bug-fix/2026-11-06-luna-model-registration.md)拥有，本记录仅扩展 MAI 定义，没有需要归档的同模型记录。

## 曾考虑的替代方案

**仅修改 DEFAULT_MODEL。** 缺少定义时会在 SDK 查找阶段失败，无法提供模型上限与输入能力。

**依据模型目录的原生 Responses 标记切换整个 provider API。** 网关的兼容入口实际可用，改变整个 provider 会影响现有 GPT 请求，不属于添加一个模型的范围。

## 验证

[注册回归](../../../../backend/src/agent/model.node.test.mjs)在修改前拒绝缺失的 MAI，修改后查找、上限、图片/推理配置和真实 SDK 会话构造通过。`npm run test:agent` 的 15 项、类型检查、文档、Notes 和 diff 检查通过；`npm run verify-model-limits` 确认四个模型与当前网关匹配。

同一个本地 key 的最小文本请求返回 HTTP 200；另一次携带合成 PNG 与 ping 工具定义的请求返回 HTTP 200，并生成 ping(value=1) 调用。该探测不执行外部业务动作，也不代替完整 Widget 生成验收。

## 后果

可以选择 MAI 构造现有固定画布和工具会话。网关声明与兼容行为仍可能变化，核验脚本继续约束上限；线上发布和页面验证记录由[直接 HTTP 生成](2026-11-05-direct-http-generation.md)维护，单项能力探测不等于完整页面质量保证。
