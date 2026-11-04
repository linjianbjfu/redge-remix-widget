# Agent Note: 桌面 Widget 直接打开系统地图验证

Status: rejected — 真机中 maps 与 HTTPS widgetURL 均交给 Widgee，不能仅靠替换 URL 直接打开地图

## 问题

路线会话最新版本已经采用，源码及手机中、大尺寸快照均含 maps.apple.com 驾车链接，但点击仍打开 Widgee。脚本通过透明 Link 覆盖地图；扩展的默认 widgetURL 固定为 Widgee 深链，主应用只处理该深链。仅凭这些事实不能证明外部地图 scheme 能否直接由系统打开。

## 方案

用户明确要求直接改动并做真机试验：调试构建从现有地图 Link 提取目标查询参数，将默认 widgetURL 设置为 maps://，不增加主应用转发、不修改源码、配置或服务端产物。点击地图中避开内部文字链接的位置，记录实际进入的应用；必要时对照原 maps.apple.com HTTPS 地址。试验不视为通用点击 API，其他 Widget 保留默认 Widgee 深链。

## 曾考虑的替代方案

**主应用接收 URL 后转交地图。** 可能满足最终打开地图，但无法证明用户要求的直接跳转路径；本次先不加入。

**继续仅使用透明 Link 覆盖层。** 无法单独检验根 widgetURL，且不同尺寸的链接区域语义不同，因此使用桌面实际点击区分。

## 验收标准

真机安装后重新加载目标 Widget，记录点击前画面、点击后前台应用及地图目的地。以 Maps 进入前台为成功，不能以 URL 合法、构建通过或脚本校验代替。失败保留证据并撤回无效试验代码；成功也不自动推广为所有 Widget 的 API。不开启导航、不改用户配置、不提交或推送。

## 风险

系统可能始终将 widgetURL 交给所属应用，或不同 URL scheme 行为不同。调试试验从现有 Link 选取地图目标，只用于验证，不构成正式的多链接优先级设计。测试会打开系统地图，并可能调整现有桌面实例的所选 Widget。

## 验证结果

2026-10-20 在 iPhone Air（iOS 27.0.1）实际运行三轮桌面 UI 试验。使用已采用的路线源码和已保存目的地，中尺寸 Widget 默认点击 URL 分别设为 `maps://?daddr=…&dirflg=d` 与 `https://maps.apple.com/?daddr=…&dirflg=d`；点击右上区域，避开透明 Link 的文字标签。两种地址均未让 com.apple.Maps 进入前台，com.linjian.Widgee 进入前台。

HTTPS 对照和最后一轮 maps 试验在主应用 onOpenURL 中增加仅记录 scheme 与 host 的界面探针，分别观察到 `Received https://maps.apple.com` 与 `Received maps://`。这证明点击确实传递了替换后的 URL，不能把结果解释为旧快照仍使用 Widgee 深链。三轮“地图进入前台”断言均失败，构建成功不计为功能通过。首轮等待 SpringBoard 菜单动画约两分钟后完成点击，后两轮复用当前桌面实例；Xcode 附加诊断收集失败不影响已保存的截图、前台状态和 URL 探针证据。

试验代码与探针已撤回，恢复默认点击行为；源码、配置和服务端历史未修改。此结果只否定直接替换 widgetURL 即可跨应用打开地图的方案，不否定其他应用使用 App Intent、快捷指令或应用转发实现启动器；这些路径本次未验证。

[Apple 的 WidgetKit 点击说明](https://developer.apple.com/documentation/widgetkit/linking-to-specific-app-scenes-from-your-widget-or-live-activity)描述了系统激活所属应用并传递 URL 的行为。后续若实现外部跳转，需定义正式的点击目标及打开处理，不能让模型仅添加透明 Link 就宣称已验证跨应用启动。
