# Agent Note: Widget 优先搜索图片并复用 storage 缓存

Status: implemented
Archived: 2026-11-05

## 问题

用户需要生成器在用户请求图片或 Widget 展示需要图片时优先搜索素材，并避免每次渲染重复搜索和下载。原示例每次调用 widget() 都联网，动态数据不缓存的通用表述也容易让模型误认为图片素材不能缓存。

## 决策

系统提示优先使用 searchImage 获取所需照片或背景素材；用户明确指定图片、相册或其他来源时遵循指定来源，不为所有纯文字 Widget 强制配图。searchImage 仍随机返回原图 URL，fetch.image 下载显示尺寸图片。系统提示只保留优先级与缓存原则，完整缓存用法位于 module:fetch 按需参考和[可运行示例](../../../../backend/src/widgee/image-search-example.ts)。

按用户明确要求，生成脚本通过 image.toBase64 编码图片，再用 storage.set 保存自包含的 base64 内容；缓存命中时以 image.fromBase64 创建本次运行可用的 URI。仅保存远程 URL、minis-image 内存句柄或绝对文件路径不构成图片缓存。原生 searchImage、fetch、storage 和 image 实现均未修改，SDK revision 不变。

每个图片用途覆盖一个固定键，记录 query、orientation、color 身份和 base64，缓存命中时不重新编码、写入、搜索或下载。主题等条件变化时替换该用途的缓存，不不断增加键；静态图片持续复用，显式换图或轮换要求决定更新时机。示例保留 Pexels CDN 的 auto=compress&w=800 显示尺寸参数，编码为 JPEG。

缓存读取或解码失败后重新下载；编码或保存失败仍显示本次已下载的图片。显式刷新失败时可复用仍匹配当前主题的缓存；没有匹配缓存时显示不可用状态，不用不匹配旧图冒充新结果。

[searchImage API 决策](2026-10-27-widget-search-image.md)继续拥有凭据、随机选择、超时与返回契约。[动态数据直接查询](2026-10-26-widget-live-data-generation.md)继续约束健康、天气、行情、定位和地图等当前数据；图片素材缓存不允许将这些历史结果作为当前值。两篇仍具备独立指导价值，保留活跃并互链，不归档或删除。

Prompt 版本为 widgee-16，只作用于后续生成和修订，不自动改写既有 Widget；网页转 Widget 的图片提取入口不在此范围。使用方式及验收由[开发指南](../../../../docs/development.md)和 [iOS 设计](../../../../ios/DESIGN.md)维护。

## 曾考虑的替代方案

**只在系统提示增加一句优先 searchImage。** 不能消除旧示例每次下载及通用缓存禁令的冲突，因此同步基础参考、按需参考与可运行教材。

**只保存远程 URL 或图片 URI。** URL 仍需下载，内存句柄跨运行失效；自包含 base64 才能随 storage 跨运行及草稿采用恢复。

**生成脚本用 files.writeImage 保存文件。** 能减少 base64 膨胀，但需要管理文件定位与目录复制。用户明确选择直接存入 storage，本次不维护第二份文件缓存教材。

**在原生 searchImage 或 fetch.image 中增加透明缓存。** 会改变随机性、网络与失效契约，且用户明确要求不改 native；生成脚本已有所需能力。

**所有图片固定每日换新。** 会给静态图片增加不必要下载，也可能违背指定的换图周期。只有用户要求换图或轮换时才增加对应更新逻辑。

## 验证

2026-10-30：图片教材及健康动态数据共 17 项 Node 测试通过，覆盖首次保存、重复渲染、全新 JS 环境恢复、主题／方向／颜色失效、缺失或损坏缓存、读写和编码失败、搜索下载失败及显式刷新回退。临时换回旧的无缓存示例时测试拒绝，恢复新示例后通过。聊天与版本兼容共 49 项测试通过，typecheck、SDK 一致性、文档与笔记门禁及新增 Swift 测试的严格 lint 通过。

独立本地 Worker 使用真实模型生成山湖图片 Widget，源码使用 searchImage、fetch.image、image.toBase64、storage.set/get 和 image.fromBase64。第二个明确指定相册的案例生成 photos.pick，没有调用 searchImage。最终生成两轮均无断流重连；较早一次验收遇到流中断且未完成，保留其失败证据，不算通过。

复用 Widgee QA iPhone 17 模拟器，2 项原生 E2E 通过、无跳过：教材使用受控图片，生成产物使用真实 Pexels 搜索与下载，两者都执行真实 storage 与图片编码解码。每次渲染使用全新 ImageStore；通过真实 LibraryStore.save(dataFrom:) 采用后删除原草稿，再次渲染仍成功。缓存命中和采用后均拦截所有 fetch 调用，断言没有网络尝试且缓存未被重写；删除缓存并阻断网络后展示空状态，没有失效图片句柄。生成产物的原生渲染截图已检查。

最终真实图片样本：首次 1.260 秒、缓存命中 15 毫秒、采用后 21 毫秒，缓存 JSON 为 91,237 字节；前三次渲染共一次 searchImage 和一次 fetch.image。这是单张图片、单次设备验收数据，不是网络或性能保证。首轮提示 o200k_base 代理计数为 10,359 → 10,590，增加 231 tokens，不包含工具 schema，也不代表网关实际计费。

本地证据位于 .playwright-mcp/image-cache-20261030，包括生成源码、SSE、generation-report.json、最终 final.xcresult、图片附件及计时。原生测试验证 WidgetRunner 和 WidgetNodeView，不验证 WidgetKit 自动调度、真机权限或相册实际选择。

## 后果

storage 内的图片内容不依赖旧 ImageStore 或草稿目录，避免后续渲染重复联网。base64 增加体积，storage 修改会重写 JSON 文件，因此提示限制为显示尺寸和少量用途；不缓存原图全集。首次搜索下载仍可能失败或超时，保存失败会让下次重新下载。

提示词引导模型生成缓存策略，不能保证每份产物都正确。实时数据规则、显式照片来源与轮换要求仍需测试覆盖。此变更不自动更新用户已有作品。

2026-10-30 已部署到 https://webclip-widget.linjsd.workers.dev，Worker 版本为 e61b4307-45cd-4132-9371-1460081232d2。线上临时会话创建返回 201，promptVersion 为 widgee-16，SDK revision 与客户端保持一致；列表返回 200，验收会话删除返回 204。版本元数据确认绑定生产 GALLERY_DB。此次上线检查未调用模型或发送客户端行为事件；真实模型与图片缓存验证使用上面的本地 Worker 和模拟器证据。
