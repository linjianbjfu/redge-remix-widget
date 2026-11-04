# Agent Note: 聊天键盘切换的横向定位

Status: implemented
Archived: 2026-11-05

## 问题

生成中唤起键盘后，聊天消息向左偏移；前后台切换也会触发布局重算。在 iPhone Air 的真实 ChatView 上重放流式片段，横向 contentOffset 最大偏移 20pt，内容宽度没有超过视口。偏移可在键盘出现前的首次内容增长时发生，恰好等于消息列表外层 padding。

[纵向滚动策略](2026-10-19-widgee-chat-stream-scroll.md)使用真实几何控制跟随，但带内边距的 scrollTargetLayout 还会参与系统目标定位，产生额外的横向位置修正。仅观察最终截图或 Y 轴无法发现这一问题。

## 决策

[ChatScrollView](../../../../ios/Widgee/Chat/ChatScrollView.swift)只对纵向坐标发出程序跟随请求；消息列表保留 LazyVStack 和内边距，不启用 scrollTargetLayout。加载更早消息由 ScrollViewReader 按显式行 ID 定位，ID 保留 seq 的 Optional 类型，并暂停底部跟随，避免布局变化立即拉回最新内容。具体跟随策略由 [iOS 设计](../../../../ios/DESIGN.md#后端通信边界)维护。

滚动状态测试覆盖安全区、键盘视口变化和阅读历史。真实页面测试使用独立偏好、资料库、附件目录和禁用分析的模型状态；初始化地址不发起网络请求，滚动容器查找排除历史抽屉的 List。逐帧记录同时包含 X/Y、内容宽度和视口，防止横移被纵向验收遗漏。

本记录拥有横向定位约束，原滚动策略记录继续拥有纵向跟随与历史阅读的理由，两篇均保留活跃。

## 曾考虑的替代方案

**只把边缘定位换成 scrollTo(y:)。** 真机仍出现 20pt 横移；需要同时移除系统目标布局。将外层 padding 换成 contentMargins 的对照也出现横向偏移，并引入不同的 inset 行为。

**禁用全部程序滚动。** 会失去流式输出和最终 Widget 的自动跟随，不满足聊天体验。

**持续在 UIKit 回调中强制 contentOffset.x=0。** 会与 SwiftUI 定位状态形成两个控制来源；从定位请求和目标布局消除横移，不需要额外纠偏回调。

## 验证

iPhone Air（iOS 27.2）通过 6 项滚动状态测试和 5 项真实页面布局测试。五种布局各采集 375～379 个流式帧，横向偏移与内容超宽均为 0pt；键盘弹出和收起、更早消息定位、短聊天、失败预览、一个或八个 Widget 历史、正文落盘与最终结果插入均通过。结果为 `/tmp/Widgee-horizontal-verified-20261029.xcresult` 的 WidgeeTests 套件；其中较早版本的 UI 测试失败不计入通过。

原实现的同一键盘布局回归以 20pt 横移超过 0.5pt 上限失败，负例为 `/tmp/Widgee-horizontal-before-scroll-20261029.xcresult`。

最终真实模型 UI 验收为 `/tmp/Widgee-horizontal-ui-acceptance-20261029.xcresult`：生成中弹出键盘、进入后台后返回、打开和收起历史抽屉、恢复完整视口、停止生成全部通过。可选中文字的无障碍边框比可见字形更宽，因此比较同一正文的横向位置；第三方键盘通过视口变化验收，不依赖应用的 Keyboard 无障碍节点。截图保存在 xcresult 附件。XCTest teardown 恢复手机原服务地址和 Keychain 身份，断言失败时也执行恢复。

构建、SwiftLint strict、iOS 契约、文档链接、Notes 和 diff 检查通过。手机安装包含修复及实验功能的版本。

## 后果

聊天正文保持纵向滚动，历史抽屉仍可横向展开；懒加载、顶部与底部跟随和用户阅读历史的状态保持独立。改动不涉及服务器或 Widget 脚本运行。

验收覆盖该手机的竖屏和默认字号。未来调整消息内边距、目标布局或安全区时，需同时运行逐帧几何测试与真实键盘、前后台回归，不能仅用最终截图代替。ScrollViewReader 的消息锚点也需要保留实际行 ID 类型和阅读状态约束。
