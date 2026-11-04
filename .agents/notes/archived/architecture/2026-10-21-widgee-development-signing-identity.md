# Agent Note: Widgee 开发团队与独立签名身份

Status: implemented
Archived: 2026-11-05

## 问题

维护者希望使用 Jianjun Chen 团队真机调试，并开通 WeatherKit、HealthKit。原安装的主应用、扩展和 App Group 注册在 Microsoft 团队；仅修改 DEVELOPMENT_TEAM 不能将这些标识交给另一个团队，也不能让新团队访问旧共享目录。运行时需要从构建配置读取共享组。

## 决策

使用新团队的独立安装身份，本机签名配置覆盖项目默认标识，不迁移或删除旧安装。已注册主应用 `com.jianjunchen.Widgee`、扩展 `com.jianjunchen.Widgee.WidgeeWidgets`、共享组 `group.com.jianjunchen.Widgee`。名称仍为 Widgee。

将主应用 Bundle ID 与 App Group 作为构建配置，扩展和测试目标的标识从主应用前缀派生。主应用与扩展的 entitlement、Info.plist 内的共享组配置来自同一构建值，SharedContainer 读取该配置；命令行与包测试保留原有非 iOS 回退。默认配置保留现有标识，具体团队与本机覆盖放在被忽略的 local.xcconfig。静态门禁校验配置连线与错误配置，不继续要求运行时代码只有一个固定团队的字符串。

在新团队为两个 App ID 启用 App Groups、HealthKit 和 WeatherKit，并启用 App Services 中独立的 WeatherKit 服务；关联同一个新 App Group。仅使用已有功能需要的能力，不启用健康后台订阅或新增健康数据类型。为本机创建 Apple Development 证书和私钥，保留团队已有证书；使用更新的开发描述文件签名并安装到已连接 iPhone。

新安装的资料库、Keychain 与健康授权独立；服务器会话仍可通过原服务地址和用户身份恢复，本地配置不自动迁移。旧桌面 Widget 仍属于旧安装，测试需添加新安装提供的 Widget。两份安装共用 widgee URL scheme 时外部链接的目标选择不可靠；本轮从明确的 App 与桌面实例进入，不宣称任意外部深链可区分两个安装。需要长期并行安装时再设计独立 scheme。

本记录拥有签名身份与共享容器配置，关联的[天气配置与服务授权](../../proposed/bug-fix/2026-10-19-widgee-weather-adoption-configuration.md)和[健康步数读取](../../proposed/feature/2026-10-20-widgee-authorized-steps-preview.md)继续拥有运行逻辑与真实服务验收。三篇保持活跃，不归档。

使用 `linjsd@126.com` 的 Jian Lin 团队并保留日常手机文件数据的后续方案见[新团队签名与真机数据迁移](../process/2026-10-30-linjsd-signing-data-migration.md)。本记录继续描述 Jianjun Chen 独立安装身份；后续决策只部分取代本机团队选择，保留这里的签名隔离、能力和回退规则。

## 验证

2026-10-21，Apple Developer 页面与 Xcode 均确认目标团队为 Jianjun Chen（E49KNR2N2R），付费个人会员有效至 2027-10-16。两个 App ID 与 App Group 已注册并关联；HealthKit、WeatherKit capability 和独立 WeatherKit 服务已启用。本机已有该团队可用的 Apple Development 私钥，保留原团队证书。

构建配置、SharedContainer 和门禁已完成。真机 build-for-testing 成功；主应用与扩展的实际签名和描述文件均包含新团队、各自 App ID、同一新 App Group，以及 HealthKit 和 WeatherKit。主应用 NSSupportsLiveActivities 为 true，真机 ActivityAuthorizationInfo 显示允许实时活动。这仅声明宿主支持，没有新增 ActivityConfiguration、活动脚本 API、灵动岛 UI、APNs 或频繁更新。

iPhone 上 SignedServiceTests 的三项检查通过：共享容器和实时活动允许状态；真实 WeatherKit 实时、逐日、逐小时返回；新应用请求健康授权后读取过去七天的正数步数。WeatherKit 检查使用 Widget 注册表，但进程仍是主应用，不能当作扩展取数证据。包测试验证共享组配置解析及非法值；静态门禁 15 项检查通过，验证身份连线、非法配置和文档断链负例；SDK、文档与 Notes 门禁通过。

新安装已通过现有 DEBUG 入口导入旧安装的服务器地址、用户标识与服务令牌，无迁移参数重启后逐项比对一致，iPhone 新进程使用持久化凭据请求服务器返回 16 个会话。迁移仅针对连接设置，旧安装、资料库、草稿与系统授权保持独立。操作流程由[iOS 账号迁移指南](../../../../ios/SIGNING.md)维护，凭据不写入仓库或诊断。

系统小组件选择器已列出并选中独立验收样例。2026-10-21，四个真机阶段通过：写入新请求标记并请求刷新、桌面天气/步数成功显示、在打开资料库前核对该请求的真实取数记录、资料库缩略图展示。新团队扩展的实时/逐日/逐小时天气和正数步数均成功，查询时间与缓存时间一致；桌面和资料库截图保存在 XCTest 附件。主应用的核对阶段只读取共享记录，不执行样例源码。操作顺序由迁移指南维护。

签名身份迁移验收完成。真实锁屏下有缓存与无缓存的回退尚未取得通过证据，独立由[锁屏健康读取验收缺口](../../proposed/bug-fix/2026-10-21-widgee-locked-health-widget-validation.md)跟踪，不计作已通过。验收样例已恢复正常请求模式，保留供维护者复查。

## 曾考虑的替代方案

**只切换 DEVELOPMENT_TEAM。** App ID 和共享组仍属于原团队，不能完成新团队签名及共享数据访问。

**将仓库全部默认标识永久替换为新团队标识。** 当前需求是真机调试，不必让所有开发者跟随本机账号；通过明确的本地配置覆盖保留可逆性。

**继续使用原团队补齐服务授权。** 可以保留安装和数据，但当前任务明确要求评估并使用 Jianjun Chen；原团队的服务编辑权限问题已有单独记录。

## 后果

本机可以通过独立配置切换团队，后续迁移无需修改运行时共享组字符串。新身份的实际签名、主应用服务读取、桌面扩展取数和展示均有真机证据；锁屏缓存回退与完整健康步数场景由关联提案继续跟踪。

新的 Apple Development 私钥允许本机代表该团队签署开发构建；不得导出或提交私钥、账号令牌和描述文件。注册 capability 不等于用户已经授权健康数据，设备仍需独立弹框授权。WeatherKit 服务配置可能需要时间生效，后续迁移仍须验证真实请求。

跨团队的数据与 Keychain 不自动继承，旧 App 与业务数据保留。连接设置的显式迁移不改变资料库、草稿和系统授权的隔离；两个安装共用 URL scheme 的歧义仍存在。
