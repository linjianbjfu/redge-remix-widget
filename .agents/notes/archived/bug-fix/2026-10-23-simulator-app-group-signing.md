# Agent Note: Simulator 构建保留 App Group 签名

Status: implemented
Archived: 2026-11-05

## 问题

Simulator 构建成功并可启动，不保证 App 与扩展能访问共享容器。禁用签名时，App Group entitlement 不进入可用的安装产物，资料库回退到应用私有目录，无法作为桌面 Widget 验收入口。

## 决策

[build.sh](../../../../ios/scripts/build.sh) 对 Simulator 默认启用签名、使用 `CODE_SIGN_IDENTITY=-` 并要求签名，保留工程 entitlements；后置的调用者构建参数仍可覆盖默认值。Simulator 不传 `-allowProvisioningUpdates`，真机继续沿用原有团队签名与 provisioning 更新参数。默认签名是本地 ad-hoc，不要求个人开发证书或 `local.xcconfig`。

本记录拥有 Simulator 构建默认值。[开发团队与独立身份](../architecture/2026-10-21-widgee-development-signing-identity.md)继续拥有团队迁移与标识配置；原生移植、背景布局及健康步数记录不拥有这个默认值，均保持活跃，无取代或归档。

## 验证

Xcode 27.1（27A9275）、专用 iPhone 17 / iOS 27.0（24A434）上的实际脚本验收覆盖以下情况。共享存储检查使用现有 `WidgeeTests/widgetReadsRealSharedStorage()`，实际调用系统共享容器、写入 storage，再经 WidgetRunner 读取。

| 配置 | 实际结果 |
|---|---|
| 原默认禁签脚本 | build 成功、安装启动成功；系统 App Group 列表为空，共享存储测试因 `SharedContainer.isShared == false` 失败 |
| 默认脚本，无 local.xcconfig | build 成功；App 与扩展均为 ad-hoc，Mach-O `__entitlements` 包含相同 App Group；系统列出共享目录，共享存储测试通过 |
| 开发者 local.xcconfig | 默认脚本的共享存储测试通过，两份产物使用该配置派生的同一 App Group |
| 无 local.xcconfig，显式空团队/空 profile、Manual 签名 | clean 后重新构建并运行共享存储测试通过；两份产物仍为 ad-hoc，包含默认 App Group |
| 显式 `CODE_SIGNING_ALLOWED=NO` | 构建完成，实际共享存储测试因容器不可用失败，确认调用者覆盖有效 |
| 调用者指定不存在的 CODE_SIGN_IDENTITY | Xcode build settings 保留该输入；Xcode 27 的 Simulator 构建仍解析为 Sign to Run Locally 并成功，不能以此作为证书缺失负例 |

[脚本测试](../../../../ios/scripts/build.test.mjs)在临时目录执行真实 shell 入口，以工具替身收集 xcodebuild 参数，并通过 `verify-ios` 执行。9 项检查覆盖默认目标、单 action、调用者覆盖、真机分支和生成失败传播；4 个执行式负例分别禁签、换掉默认身份、让默认值覆盖调用者、将 Simulator 设置泄漏到真机，均被拒绝。产物和容器能力由上面的真实 Xcode 测试证明，工具替身不承担这部分结论。

本机未移除已有 Xcode 账号或 Keychain 证书。产物的 `Signature=adhoc`、`TeamIdentifier=not set` 证明签名不使用开发证书；空团队清洁构建支持无个人配置的使用方式，但不是独立无证书 CI 主机的运行记录。没有仓库 CI 通过结论，也没有新的真机构建验收。

## 曾考虑的替代方案

**默认禁用签名，桌面验收另写 xcodebuild 命令。** 编译检查可通过，但常用入口产生不能共享数据的应用，文档中的替代命令也容易漂移。禁用签名保留为调用者显式覆盖。

**使用 Apple Development 证书签署 Simulator。** 本地模拟器不需要个人开发身份，会给无证书环境增加无关前置条件。

## 后果

常用构建入口可以用于 Simulator App Group 验收，同时保留显式编译检查和调用者设置。模拟器 entitlements 位于 Mach-O 模拟段，不能只凭 `codesign --entitlements` 输出为空判断缺失。

此改动不迁移 fallback 数据，不保证 WidgetKit 何时更新画面，也不证明真实 HealthKit、WeatherKit 等 Apple 服务能力。安装与容器检查由[模拟器流程](../../../../docs/ios-simulator-testing.md#构建安装与共享容器检查)维护；升级 Xcode 或 runtime 时应重新验证实际容器，不能仅以构建成功代替。
