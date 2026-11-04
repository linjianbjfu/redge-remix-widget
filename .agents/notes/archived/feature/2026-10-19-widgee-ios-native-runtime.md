# Agent Note: Widgee iOS 原生运行时与通信基础

Status: implemented
Archived: 2026-11-05

## 问题

本仓库缺少 iOS 应用。Widgee 需要复用 Minis 已有的 JavaScript→SwiftUI 运行时和 iOS 原生 API，避免重新实现控件、异步桥接和系统呈现。用户明确要求保留云端 LLM 接入能力，并选择通过本仓库后端管理模型和生成会话。本次移植原生运行能力，并保留独立的后端通信基础；具体 API 和产物由后端后续提供，本次不定义生成协议或产物格式。

参考源码位于 `/Users/jian/project/Minis`。其 `Packages/MinisRuntime` 不依赖 Agent，`Packages/MinisBridge` 只依赖 Runtime，适合独立移植。应用中的 `Services/AIModule.swift` 才负责将本地模型注入桥接注册表，但 Runtime 的 `SupportedAPI` 仍声明 `ai`，所以仅不复制 MLX 包不足以完成排除。

## 决策

桌面按钮由主 App 执行的网络音频播放扩展见[后台音频](2026-11-02-widget-background-audio-player.md)；普通 Widget 扩展与运行生命周期仍遵循本记录。

### 工程与来源

在 `ios/` 建立独立的 XcodeGen 工程，应用显示名称和 scheme 为 `Widgee`。目录如下：

```text
ios/
  project.yml
  Widgee/                  应用入口、资料库、运行页、导入、编辑与设置
  WidgeeWidgets/           WidgetKit 扩展、选择配置与交互 App Intents
  Packages/WidgeeRuntime/  Source、RuntimeCore 与完整 Runtime 产品
  Packages/WidgeeBridge/   BridgeCore 与完整 Bridge 产品
  Widgee/Backend/          可配置 HTTP 请求、流读取与取消，不绑定业务协议
  scripts/                工程生成、构建和移植契约检查
  README.md               配置、构建、运行与验证说明
  DESIGN.md               模块职责、运行与存储设计，以及 API 定义源码入口
```

复制选定源码到本仓库，改为 Widgee 包名与 import，不引用 Minis 的绝对路径，也不用跨仓库符号链接。保留源码原有归属信息并记录来源。Xcode 工程由 `project.yml` 生成。以源项目的 iOS 27 为最低版本；降版本需要逐一检查系统 API，不混入此次移植。

应用标识为 `com.linjian.Widgee`，扩展为 `com.linjian.Widgee.WidgeeWidgets`，共享容器为 `group.com.linjian.Widgee`，深链为 `widgee://run/<id>`。同步修改 Widget kind、Keychain service 等应用身份，不接管 Minis 的数据。开发团队通过本地构建配置提供，不复制参考工程里的个人签名配置或模型专属授权项。

### 保留的能力

| 部分 | 移植内容 |
| --- | --- |
| JavaScript 运行时 | JavaScriptCore、生命周期与状态、Promise 和回调桥接、订阅停止、错误和日志、源码解析与现有兼容处理 |
| 原生 UI | SwiftUI 视图与修饰符、交互事件、系统选择器、对话框、分享、文档等呈现 |
| 本地数据与网络 | storage、keychain、files、PDF、XML/HTML、data、units、fetch、WebSocket、流式响应和 timers |
| 系统能力 | 定位、地图、健康、日历、提醒、联系人、照片、相机、图片处理、运动、天气、通知、触觉、音频、语音、音乐、设备、快捷指令、认证等现有模块 |
| 系统智能 API | Vision、NaturalLanguage、系统翻译与语音识别；它们按原桥接调用系统框架，保留其设备、权限和资源可用性限制 |
| Widget | Core 运行时、受限注册表、Widget 安全视图子集、源码与 storage 共享、快照缓存、时间线和 Button/Toggle 交互 |
| API 契约 | SupportedAPI、结构化类型、TypeScript 声明生成、JS SDK 和无模型验证器；声明与实际注册能力保持一致 |

“排除本地模型”在本次移植中指用于生成小应用和 `ai.*` 的语言模型栈。Vision、NaturalLanguage、翻译和语音等系统 API 可能由系统内部模型实现，仍按原生 API 保留，不承诺完全离线或无需系统资源下载。

保留脚本公开的视图名、模块名、方法参数、返回值、`export default` 生命周期与 `widget()` 约定。兼容性所需的 `minis` 脚本辅助名称和内部资源协议不因应用改名而全量替换；品牌、安装身份和存储身份与脚本 API 分别处理。数据算法常量也不作为品牌字符串机械替换。

完整应用链接 Runtime 与 Bridge；Widget 扩展只链接 Core 产品，维持原有框架隔离。权限按调用请求，拒绝、取消和设备不支持时沿用可观察错误，不用成功的 stub 替代真实模块。

### 排除与应用入口

不移植 MinisAgent、MinisMLX、模型评测和训练工具、权重下载器、本地模型设置、生成对话和 GPU 后台任务。API 清单、派生声明和文档不声明 `ai.*`，不保留空实现；系统 Vision、NaturalLanguage、翻译和语音 API 仍按前述范围移植。

Widgee 提供脚本资料库、内置示例、文件导入、基本源码编辑、校验预览、真实运行、删除与 Widget 同步。本地保存脚本与稳定 ID，重启可继续运行。运行时保留源码映射和检查能力；本次不复制 Runestone 和完整可视化编辑器界面。

### 设计文档与 API 定义

[iOS 设计文档](../../../../ios/DESIGN.md)拥有当前实现的结构说明，并直接链接 SupportedAPI.swift 及其 Shapes 定义。API 名称、签名和说明从源码读取，不维护重复的 Markdown 清单；保留生成的 widgee.d.ts 供编辑器消费，门禁检查声明同步。

[地图位图](2026-10-20-widgee-map-snapshot-api.md)增加 Widgee 自有的 `maps.snapshot`；[图片搜索](2026-10-27-widget-search-image.md)增加 `fetch.searchImage` 原生桥接与全局 `searchImage`。移植门禁在不可改写的 Minis 来源清单之外明确列出这些扩展，仍拒绝其他未声明的增删。

### 后端通信基础

原生移植保留独立通信基础，不预设网页产物或生成协议。`Widgee/Backend/BackendClient.swift` 基于 URLSession，支持服务地址、相对路径、方法、headers、body、普通响应与字节流，并原样保留 HTTP 状态、取消和网络错误。底层网络实现可注入测试。

生成会话、认证、SSE 解析和源码采用由独立的[原生 Widget 聊天生成](2026-10-19-widgee-widget-chat.md)记录拥有；业务适配器位于同一 Backend 目录，聊天界面位于 Widgee/Chat。通信基础仍不依赖具体业务 DTO，真实 HTTP 测试与生成业务验收分开。

### 现有决策检查

本记录拥有 Widgee 原生移植与通信基础。现有 HTML widget 产物、data.json 和后端会话决策不受影响，无需修改、归档或删除；本次不建立与它们共享的业务协议。

服务端聊天生成与 iOS 业务接入由[原生 Widget 聊天生成](2026-10-19-widgee-widget-chat.md)拥有；本记录继续描述已实现的运行时与通信基础。

## 曾考虑的替代方案

**复制整个 Minis 应用后删除模型包。** Composer、AppEnvironment、设置和后台任务仍依赖本机模型，不属于当前原生移植范围。以独立 Runtime/Bridge 搭建应用入口。

**直接链接本机 Minis 包。** 其他 checkout 无法独立构建，修改原项目也会改变 Widgee 行为，因此将选定源码复制进本仓库维护。

**只移植 Bridge。** Bridge 依赖 Runtime 的类型、Host、回调、订阅和系统呈现，不能独立提供原生运行能力。

**将通信代码独立成 Swift Package。** 当前只有主应用使用，放在 Widgee/Backend/ 即可，不增加额外包配置。

**保留生成的 Markdown API 清单。** 其条目来自 SupportedAPI，没有独立维护内容；设计文档链接源码即可。TypeScript 声明有编辑器消费用途，继续保留自动生成和一致性检查。

**在原生移植中定义后端生成协议。** 用户限定原生移植只提供通信能力；生成协议由独立聊天功能拥有，不复用现有 extra.js/widget.html 协议。

## 后果

原项目要求 iOS 27，直接移植会继承设备版本限制。本机存在 Xcode 27.1 和 iOS 27.1 SDK；系统默认开发目录当前为 CommandLineTools，验证时通过 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` 选择 Xcode，不改全局设置。

HealthKit、WeatherKit、App Group 等需要正确签名与服务能力；相机、音乐、定位、翻译等在模拟器中的可用性不能代表真机。缺少签名或设备时只能报告相应验证缺口，不能宣称所有原生调用已验收。

原运行时执行的是具备原生权限的脚本，不是适用于任意不可信代码的安全沙箱。现有 watchdog 将超时上下文标记为不可用，不等于 JavaScriptCore 公开提供强制中断。收到云端源码不自动进行带真实系统能力的运行或发布为 Widget；本地 stub 校验也不能证明任意代码安全。

Widgee 持有源码副本后需要自行维护，与 Minis 的后续改动不会自动同步。保留 API 名称和 Core 分层降低后续对照成本。通信基础的测试不能代替[聊天业务接入](2026-10-19-widgee-widget-chat.md)的生成、恢复与产物下载验收。

## 验证

`npm run verify-ios` 通过：40 个视图、49 个修饰符和 40 个模块与移植基线一致，类型声明同步；7 项负例检查覆盖能力丢失、禁用依赖、应用身份及文档链接。Runtime 的 74 项测试通过，包含脚本加载、异步桥接、订阅、存储、Widget 渲染与交互，以及注释和字面量中的 widget 文本识别。

连接的 iPhone Air（iOS 27.0.1）完成签名、安装及运行。设备测试结果：

| 路径 | 观察结果 |
| --- | --- |
| 单元测试 | 6 项通过，覆盖资料库恢复／删除、请求构造、真实 storage 隔离、App Group Widget 渲染及真实 HTTP／流读取 |
| 应用界面 | 3 项通过，覆盖计数持久化、原生弹窗、设置、新建校验保存，以及错误编辑不能覆盖已保存版本；测试创建的资料库条目使用独立名称并清理 |
| 文件导入 | 经 files.writeText 与系统分享保存 JavaScript 到“我的 iPhone”，再从系统文件选择器导入、校验、保存并真实运行 |
| 主屏幕 Widget | 添加并选择导入脚本；Button 经 App Intent 将计数从 0 改为 1，桌面更新；再次交互后点击深链回到已经打开的运行页，新 Host 读取更新后的 storage；该场景另有一次专门的 XCTest 验收通过 |
| 权限拒绝 | 定位权限选择“不允许”后，真实桥接向脚本传播 `Permission denied for Location`，页面显示错误；stub 校验没有请求此权限 |
| 真机网络 | 允许本地网络后，fetch 请求返回 `HTTP 201 phone-ok`；BackendClient 的设备测试验证正文、headers、201／404 状态和分块 UTF-8 流 |

本机 `test-transport.sh` 通过同一份 BackendClient 的真实 HTTP、流读取和取消检查。SwiftLint strict、`npm run verify-docs`、`npm run verify-notes` 与 diff 空白检查通过。构建和复验命令由 [iOS 说明](../../../../ios/README.md)维护；这些证据对应原生移植，不包含后续聊天生成。

设备验收覆盖了三个运行时缺陷的修正：启动时异步树不能被初始树覆盖；stub 预览必须提供 Host 环境；重复打开同一脚本的 Widget 深链必须创建新的 Host。Widget 静态识别的回归用例在修复前失败、修复后通过，忽略注释、字符串、模板和正则中的示例文本。

## 验证限制

本机没有安装模拟器系统镜像，因此模拟器只完成测试目标编译，界面测试在连接的 iPhone 上执行。真机验收期间发生过锁屏和测试连接中断；这些运行不计入通过结果。最初局域网请求被权限拒绝，最终允许本地网络后的 HTTP 测试才计为通过。

健康、定位成功取值、相机、联系人、音乐、翻译、天气、日历、提醒、运动、录音、语音识别与通知等系统调用没有逐项完成真机成功路径验收；它们保留原生实现、权限声明和 API 基线，编译及 stub 结果不代表真实设备成功。设备网络取消由本机真实流测试覆盖，尚未另做 iPhone 断网／取消测试。Widget 的系统预算、后台时间线和锁屏各尺寸没有长期运行验证。

云端生成、会话恢复、认证及产物下载由[聊天生成记录](2026-10-19-widgee-widget-chat.md)单独给出验证证据。
