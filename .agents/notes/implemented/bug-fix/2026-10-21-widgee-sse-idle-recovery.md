# Agent Note: 长生成期间的 SSE 心跳与订阅释放

Status: implemented

## 问题

模型思考或生成工具参数时可能长时间没有正文增量；HTTP 客户端和代理可以因空闲超时中断连接。历史 URLSession 对照中，首帧后静默 70 秒在 60.995 秒失败，每 10 秒发送注释则在 70.050 秒正常结束，说明业务进度与连接字节保活是不同职责。

## 决策

共享 Hub 为实时订阅每 15 秒发送 SSE 注释，有限历史回放不启动定时器。心跳不带 id、不落盘、不触发模型、不更新 last_progress_at，不代表生成进度。HTTP 字节保活与 30 秒 DO alarm 独立，不能用网络心跳替代任务保活。[网页客户端协议](../../../../docs/protocol.md#sse-事件)拥有当前帧格式。

订阅监听 writer.closed，读端取消和写失败触发资源清理；正常关闭先停止心跳再排出终态。心跳与业务事件共用 64 次待完成写入上限，溢出时 abort 释放阻塞写入，不能阻塞生成。定时调度按实例注入，测试不改进程全局时钟。

本地 Wrangler 和直接 workerd 实验中，真实 HTTP socket 关闭后 20 秒内未必向 JavaScript 流传播取消；直接 reader.cancel 则可以立即释放订阅。不能依赖立即收到 writer.closed 拒绝。局部处理流失败，不全局吞掉异常；队列上限约束未消费写入，平台隐藏断开时可能留到 turn 结束才释放。若要引入 enable_request_signal，需单独验证 Worker 到 DO 的传播和独立生成任务的影响。

原 iOS 客户端的有界重连已随原生路径移除，不能将其三次恢复预算视为 test CLI 行为。CLI events 读取一次流，调用者用 since 继续；stream_end 才表示连接正常结束，turn_end 表示业务轮次终态。协议级幂等和有序游标继续由[后端架构](../architecture/2026-09-28-backend-architecture.md)拥有。

## 曾考虑的替代方案

**只延长客户端超时。** 不能恢复实际网络中断，也无法约束代理的空闲回收；HTTP 心跳仍有独立价值。

**只加心跳便宣称自动恢复。** 健康连接保活不能恢复已断连接。自动重连、退避、游标和请求身份需要客户端独立实现。

**改成 WebSocket。** 当前提交后是单向推送，持久化事件已有续传语义；换传输也仍需心跳和连接生命周期管理。

## 验证

[Hub 测试](../../../../backend/src/do/hub.test.ts)覆盖心跳格式和周期、无 id、有限流无定时器、读端取消、队列溢出及释放。[DO 测试](../../../../backend/src/do/user-agent-do.test.ts)独立覆盖 alarm 保活与恢复。历史 URLSession 70 秒对照不证明当前任意代理或网络均可保活，也不证明 TCP 关闭立即传播到 JS。

## 后果

心跳增加少量网络写入，降低长时间无正文造成的空闲断开风险；不承诺逐 token 无损、自动重连或模型调用恰好一次。DO stale recovery 仍按持久化进度判断，不能以收到网络注释延长恢复预算。原生代码删除与共享 Hub 保留的边界由[网页生成保留决策](../../implemented/simplification/2026-11-05-web-generation-only.md)拥有。
