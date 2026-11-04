# Agent Note: Widgee 进度条缩略图一致性

Status: implemented
Archived: 2026-11-05

## 问题

每日喝水详情显示青色的部分进度，资料库缩略图却显示带禁止符号的黄色整条。两处文字均为 250 / 2000 mL，截图未显示数据计算差异。

详情直接显示 WidgetNodeView；WidgetThumbnailStore 则将同一渲染器通过 ImageRenderer 转成 PNG。iPhone Air（iOS 27.0.1）固定视图树复现确认：系统默认 ProgressView 的底层平台视图不能被 ImageRenderer 绘制，日志报告 `Unable to render flattened version of PlatformViewRepresentableAdaptor<Base>`。部分进度的实时截图包含 15pt 青色填充，PNG 中青色宽度为零并出现 520 个黄色像素。原 LibraryUXTests 的像素一致性用例仅包含 Text，且两侧均使用 ImageRenderer，不能证明与屏幕上的控件一致。

## 决策

共享 Widget 渲染层给确定进度的 ProgressView 使用纯 SwiftUI 绘制的线性样式，使聊天、详情、桌面与缩略图使用同一实现；保留标签、进度语义、tint、4pt 轨道和布局占位。生成脚本、模型提示词和脚本 API 不变。

缩略图键使用 renderer-2，使已缓存的错误 PNG 在下次读取时重建，保留脚本及用户数据。缓存来源、隔离与容量继续遵循[可视化资料库](../feature/2026-10-19-widgee-tabbed-chat-library-ux.md)，共享布局继续遵循[预览与桌面一致性](2026-10-19-widgee-widget-preview-parity.md)。两篇旧记录仍拥有独立决策，不被本记录取代。

## 曾考虑的替代方案

**改生成提示词，要求模型用 Shape 拼进度条。** 无法修复已保存脚本，且让模型承担原生渲染兼容性问题。保留 ProgressView API，在宿主解决。

**只在缩略图路径画自定义进度条。** 能去掉占位，但会保留两套外观实现，后续仍可能与详情不同。

**用 UIHostingController 截取整个列表缩略图。** 可作为系统控件兼容方案，但增加视图挂载、布局时机和生命周期成本。本问题可在默认进度条单独复现，共享样式能修复且继续复用现有图片管线，因此不替换整个截图实现。

## 后果

进度条不再依赖系统平台视图，代价是由 Widgee 维护轨道和填充样式。系统着色模式可能影响颜色，普通模式截图不能证明所有系统外观一致。本次未修改 Gauge、Toggle 或应用表单的非确定进度加载指示器；若这些控件出现同类问题，应分别复现，不能把共享渲染器等同于 ImageRenderer 支持所有控件。

## 验证

WidgetProgressTests、WidgetPresentationTests、LibraryUXTests 共 13 项真机测试通过，覆盖 18 种尺寸、外观和进度组合、挂载视图与离屏图片的进度宽度、旧 renderer-1 PNG 拒绝与重建、磁盘图片复用。修复前回归测试能拒绝黄色占位。测试入口见 [iOS README](../../../../ios/README.md#真机聊天生成测试)。

现有每日喝水通过列表／详情及冷启动 UI E2E，截图中两处均为 250 / 2000 mL 青色进度；无障碍树保留 ProgressIndicator 和 12.5% 值。测试使用卡片合并后的无障碍标签，并取同名 Widget 中的列表第一项。此前测试定位错误的轮次不计为通过。

真机桌面核对使用临时 XCTest 将现有 Widgee 实例切换到每日喝水，确认相同 250 / 2000 mL、12.5% 进度及青色样式，再恢复原倒计时并验证“旅行出发”出现。未点击计数按钮、修改脚本或 storage。覆盖范围为 iPhone Air 的普通显示模式，不包括系统着色模式或完整 VoiceOver 人工走查。
