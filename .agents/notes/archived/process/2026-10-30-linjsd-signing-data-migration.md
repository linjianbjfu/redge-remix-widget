# Agent Note: linjsd 团队签名与真机数据迁移

Status: implemented
Archived: 2026-11-05

## 问题

维护者在 Xcode 登录 `linjsd@126.com`，要求使用该账号把 Widgee 部署到日常 iPhone，启用 WeatherKit、HealthKit 等现有能力，并保留旧安装的文件数据。

该账号的有效个人团队是 Jian Lin（Team ID `6LVVKQ7F32`）。旧安装使用 Jianjun Chen 团队的 `com.jianjunchen.Widgee`、扩展和 App Group；不同团队不能沿用这些标识、共享容器或默认 Keychain 访问组。直接切换 `DEVELOPMENT_TEAM` 无法签名，也不会迁移资料库、草稿或客户端 UUID。

本记录部分取代[现有开发签名身份](../architecture/2026-10-21-widgee-development-signing-identity.md)的本机团队选择，保留其签名隔离、能力和回退原则。[Keychain 客户端身份](../feature/2026-10-26-client-keychain-identity.md)继续拥有 UUID 生成与持久化规则。

## 决策

Jian Lin 团队使用以下独立身份：

- 主应用 `com.jianlin.Widgee`；
- Widget 扩展 `com.jianlin.Widgee.WidgeeWidgets`；
- App Group `group.com.jianlin.Widgee`。

主应用与扩展都启用 App Groups、HealthKit、WeatherKit capability，关联同一个 App Group，并在各自 App Services 中启用 WeatherKit。HealthKit 不启用后台投递，也不增加当前实现未使用的数据类型。本机忽略文件 `ios/local.xcconfig` 使用 Team ID `6LVVKQ7F32` 和新主 Bundle ID；仓库默认标识保持团队无关。

Xcode 自动签名注册实际 iPhone、生成两个开发描述文件，并使用本机 Apple Development 私钥签名。主应用和扩展的实际 entitlement 均包含新团队、各自 App ID、同一 App Group、HealthKit 和 WeatherKit。

### 文件数据迁移

迁移脚本 [signing-migration.mjs](../../../../ios/scripts/signing-migration.mjs) 使用 `devicectl` 备份来源 `appDataContainer` 和 `appGroupDataContainer`。备份清单记录每个文件的大小和 SHA-256，拒绝符号链接、来源不唯一、容器不可读和内容漂移。旧 App 在整个流程中保留，不卸载、不覆盖。

恢复器把资料库、Widget 源码与 storage/files、Chat 草稿、快照和尺寸偏好恢复到新 App Group；把 Chat 缓存、附件、投稿状态、分析队列和重命名后的主偏好恢复到新 App Data。它只重写 Widgee 自有 JSON 中已确认属于旧 App 或旧 App Group 的文件 URL，外部 URL 和非 JSON 文件保持原值。

CoreDevice 27.1 的文件服务有三条必须保留的约束：

- `device copy to --quiet` 会返回成功但不落盘，写入不能使用 `--quiet`；
- 同一 domain 的多次写入是独立快照，后一次会覆盖前一次，必须在一次命令中重复 `--source` 并写入共同父目录；
- 新 App 首次正常启动并产生可读的空 `library.json` 后，App Group 才完成初始化。恢复必须等待这个可观察状态，再写入并在冷启动前后读回相同的资料库 ID。

真实服务 XCTest 会重装宿主并清空 App Group。测试结束后使用 `--replace yes --skip-install yes` 从同一备份覆盖 Widgee 自有文件，不卸载 App，从而保留新签名的 Keychain UUID 和系统授权。

### 新客户端身份

维护者明确接受新 App 生成新的客户端 UUID。迁移工具不读取、导入、覆盖或删除 Keychain UUID。旧 UUID 对应的服务器会话不会自动归属新身份；复制的旧 Chat 缓存作为文件备份保留，但不是新身份的当前服务缓存。

Widget 或草稿在旧访问组中的其他 Keychain 密钥也不迁移。HealthKit、定位等系统授权属于新 App 身份，需要重新授权。

## 验证

Apple Developer 后台确认 Jian Lin 团队有效至 2027-10-30。两个最终 App ID 和 App Group 已注册；主应用和扩展的 App Groups、HealthKit、WeatherKit capability 与 WeatherKit App Service 均已启用。实际签名为 Team `6LVVKQ7F32`，Bundle ID 和 App Group 与上述配置一致。

来源 App 是 `com.jianjunchen.Widgee`，来源 App Group 是 `group.com.jianjunchen.Widgee`。只读备份包含 39 MB App Data、13 MB App Group，共 370 个文件。恢复前后资料库都是 23 个条目且 ID 集合完全一致，Chat 草稿都是 97 个目录，后端地址保持 `https://webclip-widget.linjsd.workers.dev`。旧 App Group 容器路径在恢复后的 JSON 中匹配数为 0。旧 App Data 有 8 个 Chat 缓存数据库；新身份正常启动后为 9 个，原缓存和新身份自己的缓存同时保留。

真机 `SignedServiceTests` 的共享容器、Live Activities 和过去七天正数步数读取通过，HealthKit 授权已由用户允许。WeatherKit 在服务刚启用后的首次三接口测试触发 8 秒超时；紧接着只重试真实 WeatherKit 测试，实时、逐日和逐小时全部在 1.211 秒内通过。测试重装后重新覆盖文件数据，最终正常冷启动再次核对 23 个资料库 ID 和 97 个草稿目录不变。

迁移脚本 8 项单元测试通过，覆盖容器前缀识别、外部 URL 保留、目标 App 和 App Group 校验、空容器例外、清单漂移、符号链接拒绝、staging、偏好改名和无身份依赖的备份。`npm run verify-ios -- --static` 的 33 项检查、`npm run verify-widgee-sdk`、`npm run verify-docs`、`npm run verify-notes` 和 `git diff --check` 通过。

## 曾考虑的替代方案

**只切换 `DEVELOPMENT_TEAM`。** 旧 App ID、App Group 和 Keychain 访问组属于另一个团队，不能完成新团队签名或共享数据访问。

**继续使用 `com.linjsd.Widgee`。** 首次自动签名返回该标识不可用，最终改用维护者指定、与团队名称一致的 `com.jianlin.Widgee`。自动签名尝试在 Apple 后台留下了未使用的 `com.linjsd.Widgee` 与扩展 App ID，本轮不执行未经确认的删除。

**改用 `com.linjsd126.Widgee`。** 该前缀更接近登录账号且重名概率较低，但维护者明确选择 `com.jianlin.Widgee`，因此没有注册。

**恢复旧 UUID。** 原方案尝试把 Chat 缓存中的 UUID 写入新访问组，但真机测试宿主已按正常规则生成新身份。维护者接受新 UUID，因此删除跨签名 Keychain 恢复接口，不给产品增加身份覆盖路径。

**不恢复文件，使用全新安装。** 最简单，但会放弃资料库、Widget storage、草稿和偏好，不满足本地文件数据保留要求。

**逐项执行多个 `device copy to`。** CoreDevice 把每次调用视为 domain 快照，后一次覆盖前一次。最终实现为每个 domain 一次多源事务。

## 后果

手机上保留两份同名 Widgee：旧 `com.jianjunchen.Widgee` 和新 `com.jianlin.Widgee`。资料库、Widget 文件、草稿和连接偏好已迁移，新 App 使用新团队的 WeatherKit、HealthKit 和共享容器。两份 App 共用 `widgee://`，外部深链选择仍不可靠；验收从明确的 App 实例进入。

新 UUID 不拥有旧服务器会话，旧 Keychain 密钥和系统授权也不继承。HealthKit 已重新授权；需要密钥的 Widget 仍需重新登录或填写。旧 App 和带校验清单的本地备份继续保留，作为回退来源。

Apple 后台存在两个未使用的 `com.linjsd` App ID。删除这些云端标识是独立、破坏性的账号清理，不属于本次已授权范围。
