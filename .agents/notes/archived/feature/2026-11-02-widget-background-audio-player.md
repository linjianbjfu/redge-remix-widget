# Agent Note: 网络音乐后台播放与桌面按钮控制

Status: implemented
Archived: 2026-11-05

## 问题

用户需要以网络音乐 URL 为输入，通过 API 播放和暂停，不显示播放器界面；桌面 Widget 的按钮也能直接执行，不打开 App。详情页真实关闭时暂停该 Widget 的音乐，锁屏或切换其他 App 时继续播放。多个 Widget 之间只允许一个音源出声，被接管的 Widget 也需要显示暂停。

music 模块控制系统媒体资料库，audio.play 则先下载完整文件并等待播放结束，两者都不适合承载这套网络流媒体和生命周期语义。普通桌面按钮由扩展执行，不能持续持有后台播放器。

## 决策

独立的 audioPlayer 模块提供 play(url?, onStateChange?)、pause() 和只读 getState()。主应用使用唯一 AVPlayer，控制权归属本地 Widget appID；不改变 music 和旧 audio 的参数及 Promise 语义。具体 API 由 [SupportedAPI](../../../../ios/Packages/WidgeeRuntime/Sources/WidgeeRuntimeCore/SupportedAPI.swift)及[类型声明](../../../../ios/widgee.d.ts)维护，组件归属见 [iOS 设计文档](../../../../ios/DESIGN.md#网络音频)。

生成阶段按歌手／歌曲查找音源由[内置 skills](2026-11-02-widgee-native-generation-skills.md)提供；播放器接收 URL 的契约与本记录的生命周期保持独立。

play 在媒体准备完成、取得音频会话并发出播放请求后完成，不等待实际出声或曲目结束。初始媒体准备保留 5 秒超时。后续缓冲、播放和失败通过状态 callback 与 getState 反映，不再改变已完成的 Promise。当前拥有者重复播放同一 URL 保留进度；新 URL 替换音源，自然结束后显式播放从头开始。无参数恢复仅适用于当前拥有者仍在本进程中的音源。

### 桌面动作与运行范围

Button 通过 intent: 'audioPlayback' 选择专用 AudioPlaybackIntent。该 Intent 在主 App 后台执行，不打开界面；普通 Button／Toggle 沿用扩展执行路径。执行前核对 appID、最新源码、节点和音频标记；只给显式动作及其原生异步返回阶段注入控制能力，错误进程和无授权桥接拒绝调用。

widget()、onAppear、时间线、Chat 自动预览、缩略图、截图生产和离线校验不能启动或暂停音乐。真实 Widget 渲染可读取 getState；离线样例状态不写入真实快照。桌面播放按钮提供 URL，避免首次启动依赖旧进程内存。

### 单音源与生命周期

新拥有者接管前，原生控制器先暂停旧音源并保存旧拥有者的 paused/superseded 状态，再加载新音源。旧拥有者的暂停、恢复和迟到事件不能影响新拥有者；新音源暂停、结束或失败后不自动恢复旧音源。请求代次隔离换源与加载取消，不维护各首歌的历史断点或无限队列。

播放器寿命独立于短时 JavaScript runtime 和页面视图。RunPresentation 真实退出时暂停该 Widget 当前拥有的音乐；锁屏、scenePhase 后台变化及普通 runtime.stop 不等于详情退出。删除 Widget 会释放其音源和状态。后台能力由 project.yml 的 UIBackgroundModes: audio 与 playback 音频类别提供，不使用静音音轨、JS 定时器或无限后台任务保活。

### 状态与回调

状态由原生层按 appID 保存到 App Group 的 Library/audio-player.json，扩展只读。原子写入成功后才发送存活 callback、使旧视图快照失效并合并请求 WidgetKit 重载。状态不依赖脚本自行保存 playing 标志，也不依赖 callback 成功执行。写入失败会报错，仍立即暂停旧音源，不假报同步成功。

状态包含 idle/loading/buffering/playing/paused/ended/failed、原因、playbackId、单调 revision 和 Unix 毫秒 observedAt；失败附有界 errorCode，不暴露 URL、凭据或响应正文。无记录返回 idle、revision 0，其余历史字段为 null。被接管事件保留原 playbackId；换源不重置该 Widget 的 revision。新主应用进程首次读取状态时将残留活跃记录校正为 paused/process_restarted。

显式新 callback 替换同一 BridgeSession 的旧注册并交付最新状态；省略 callback 保留原注册。runtime 结束时解绑，不保活或重建旧 JS 闭包，也不跨 runtime 转交 callback ID。同步异常和 Promise 拒绝不阻塞原生暂停、换源及状态提交。callback 不是逐秒进度流。

所有 Widgee 实例共用一个 Widget kind，reloadTimelines 可能刷新多份实例，具体显示时间由系统决定。扩展读取的是最新已知状态；强制结束进程时不保证写入或交付最后一次事件。

### 音频会话协调

网络播放器、旧 audio 录放、SpeechModule 与 Chat 录音共用音频会话协调器。录音或语音输入暂停音乐，释放旧租约不能停掉新拥有者。旧 audio 初始化失败也会清理会话；主线程上的释放同步入队，避免下一次获取越过清理。

系统中断、耳机断开和媒体重置通过原生通知处理。只有系统建议恢复、拥有者及请求代次仍有效时才恢复；用户暂停或详情关闭会使旧恢复建议失效。结束录音不擅自恢复音乐。默认采用 playback 的非混音行为，不承诺与外部音乐同时播放。

[原生运行时](2026-10-19-widgee-ios-native-runtime.md)继续拥有 Core／Full 分层和普通生命周期；[Chat 语音](../../proposed/feature/2026-10-29-chat-speech-input.md)继续拥有识别状态机和麦克风行为。

## 曾考虑的替代方案

**复用 music.play(url)。** music 的参数是系统资料库歌曲 ID，pause 也控制系统音乐播放器，重载会混淆控制对象。

**直接改造 audio.play。** 它的完整下载与等待曲目结束语义已被脚本使用，改为流式提前返回会破坏兼容。

**等待实际进入 playing 才完成 play。** 这需要额外协调缓冲、启动状态和超时。用户选择准备完成并发出播放请求即成功，实际状态由 callback 和 getState 提供。

**让 Widget 扩展或 JS runtime 持有播放器。** 扩展和动作 runtime 都短暂存活，后续暂停也不能保证找到同一实例；原生长期播放器需要独立归属。

**把全部普通按钮改为音频 Intent。** 会使计数等普通动作也启动主 App，扩大执行进程和生命周期变化。显式按钮标记避免扫描函数源码猜测用途。

**创建播放器界面或用深链打开 App。** 不符合桌面直接控制且不弹界面的要求。系统音频指示和路由界面不属于 App 播放器界面。

**只通过 callback 保存桌面状态，或常驻／复活旧 runtime。** 原 callback 可能已经销毁，不能可靠更新被接管的 Widget；保留闭包还增加内存和清理负担。原生快照和刷新请求独立于 callback 存活。

## 后果

支持可直接访问的 HTTPS MP3、AAC/M4A 和纯音频 HLS；实际解码交给 AVFoundation，不按后缀判断。签名查询参数可随 URL 传入；不提供 Cookie、任意请求头、DRM、网页音源解析、播放列表、循环、拖动进度、音量、离线下载或独立锁屏控制面板，不增加全局明文 HTTP 豁免。

进程被系统终止或用户强制结束后，不承诺自动重启和断点持久化。HLS 直播恢复位置受服务端直播窗口影响。后台 audio 配置覆盖整个 App，因此旧 audio 的取消和失败清理也需要回归测试。控制器和原生资源不下沉到 backend。

## 验证

2026-11-02 在 iPhone Air、iOS 27.2 上验证。用户确认实际桌面冷启动播放有声音、A→B 接管和 A 暂停显示符合预期、锁屏持续有声及关闭详情暂停。桌面 A 使用真实模型生成的作品；冷启动操作前确认主 App 进程不存在，操作后确认主 App 进程出现。采样记录 A 的暂停提交约 206 毫秒后 B 进入 playing；这是原生状态顺序，桌面刷新延迟未做精确计时。

自动验证包括：

- WidgeeBridge 基础 24 项、音频与动作专项 25 项，覆盖拥有者隔离、快速交替、迟到事件、同源恢复、失败、状态持久化、回调替换／解绑／抛错、普通计数动作和租约顺序。
- WidgeeRuntime 97 项、服务端 Chat 29 项、音频教材 1 项。
- 真机音频 7 项及独立断连用例 1 项：MP3/HLS、模型产物原生动作、录音抢占、准备超时、404、连接中断、媒体重置通知、旧录音初始化失败释放。录音失败用例修复前复现 audio_session_busy，修复后通过。
- iOS 配置与 API 门禁 35 项、SDK 一致性、后端类型检查、文档和 Agent Notes 门禁。

媒体重置测试通过通知适配执行，不重启设备媒体服务；未实测真实来电及蓝牙设备拔插。构建和测试记录保存在本地 .playwright-mcp/audio-player-finish/。测试作品及播放状态已清理，临时音源服务已停止；用户负责移除两份桌面测试小组件。
