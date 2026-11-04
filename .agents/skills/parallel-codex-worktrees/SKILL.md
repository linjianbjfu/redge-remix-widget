---
name: parallel-codex-worktrees
description: Coordinate parallel Codex CLI agents for separate Beads tasks in isolated git worktrees, with dedicated local backends and browsers as needed, and one PR per task. Use for requested parallel implementation or reusing this repository's multi-agent workflow, including custom-provider startup failures.
---

# Parallel Codex worktrees

主 agent 协调，子 agent 各领一个任务，在独立 worktree 开发；需要端到端验收时，各自使用专用 backend 和浏览器 profile。采用当前用户的 Codex 配置。此 skill 不改变当前会话的方案确认、模型选择、工具权限或 commit／push／merge 授权；已经明确授权的步骤直接执行。

## 拆分与领取

使用 [beads](../beads/SKILL.md)。可拆分的父任务建为 `epic`，子任务通过 `--parent` 归属，实际先后依赖用 `bd dep add` 表达 `blocks`，不能只写在说明中。无依赖任务才同时开发；不能为了并行隐瞒尚未落地的共享接口。

每个子任务写清已确认范围、验收、文件所有权和 PR 目标。共享配置、资源门禁、客户端协议、Agent Note 状态和最后集成指定唯一 owner；主 agent 可以拥有单独的集成任务。并行数取决于当前 agent 限额、内存和浏览器负载，不固定为三人。

主 agent 先核对任务归属与依赖，用每个子 agent 的唯一 actor 原子领取，确认 `in_progress` 与 assignee 正确后，再创建独立 branch/worktree 并启动对应 agent。记录任务 ID、角色、路径、branch 和已确认的 base SHA。子 agent 核对既有归属后才能开始代码调研、方案规划、环境准备、实现或测试；领取失败不能覆盖其他 assignee 或创建重复任务。所有 worktree 使用同一个 Beads 数据库：用 `bd where` 核对，必要时用 `bd -C <协调仓库>` 操作，不在每个 worktree 执行 `bd init`。工作期间按实际 TTL 保持 heartbeat；长命令运行时可由确认进程仍在工作的协调者使用同一 actor 续租，丢失归属则停止任务并处理冲突。

父任务的确认状态与执行权限必须传给子 agent。CLI 子进程没有父会话的完整上下文；使用[启动与任务模板](references/launch.md)，不要让它重新猜测需求或重复请求已有批准。

## Codex 配置与启动

先核对当前 `CODEX_HOME`（未设置时为 `~/.codex`）的配置、所用 profile 和调用级覆盖，读取 provider、model、reasoning effort 及 provider 的认证方式。只记录非敏感设置和凭据是否可用，不输出整个配置或凭据文件。子进程沿用同一个配置根及认证环境；需要固定本次设置时用 `-c model_provider=…`、`-m …` 和 reasoning 覆盖，不改全局配置。

用户指定相同本地 provider 时，使用 `codex exec -C <worktree>`。已有原生 subagent 能继承所需配置时也可使用；若在执行前持续断流且没有 provider 参数，不应把它当成代码失败，也不应擅自换模型。记录原始错误，检查本地 CLI 配置，先启动一个小范围任务验证 CLI 路径，再启动其他任务。CLI 也失败时依据具体错误排查，避免重复启动同一批任务；任何启动失败都不自动授权放宽 sandbox 或绕过工具拒绝。

子进程的权限不得超过父会话允许范围。按当前工具能力与授权传 sandbox／approval 配置；不要把过去使用过的 `danger-full-access` 当作所有任务的默认值。Codex 的 provider/model 与被测 backend 的 `LLM_*`/`DEFAULT_MODEL` 是两套配置，不能为了让 agent 使用相同模型而修改产品模型注册表。

每个进程保存独立 prompt、JSONL、stderr、final 文件及进程/session ID。先确认有实际执行事件，不能以创建出文件、thread ID 或工具 session ID 判断 agent 已正常工作。主 agent 持续检查完成、错误和必要进度，定期向用户更新；等待时保留响应新消息的能力。

## 隔离 backend 与浏览器

按[开发指南](../../../docs/development.md)执行网页、真实模型与 Browser Run 验收，并为每个任务分配独立资源：

- **服务**：从自己的 worktree 启动；用 `mktemp -d` 分配独立持久化目录，Wrangler 绑定 `127.0.0.1`，使用 `--port 0 --inspector-port 0`。读取 Ready 日志的实际 URL，再请求会话列表确认服务可用。
- **浏览器**：交互式捕获和预览为每个任务设置独立的 `WEBCLIP_BROWSER_USER_DATA_DIR`，不能共享日常或其他任务的登录态。无头测试沿用自动分配的私有临时 profile；退出时等待浏览器进程结束。
- **配置**：环境文件放在该 worktree 的 `backend/` 下、权限为 0600，并核对被 git 忽略。仅继承测试所需模型配置，使用唯一测试 user；不得复制日常账号身份或把模型密钥填到客户端。
- **资源记录**：把所拥有的服务进程/session、监听 URL、浏览器 profile 和证据目录写入任务进度，凭据只保存到私密环境文件。启动、生成和录制不要与同一 checkout 的源码编辑交错。

独立 browser profile 不隔离共享桌面的键盘、鼠标或录制窗口。需要操作同一 UI 表面时，由主 agent 串行授予使用权，记录 owner 和释放状态；操作前重新确认目标。资源不足时降低并行浏览器数，不停止其他任务的进程。

## 验证与 PR

一个实现任务一个 PR，子 agent 在既有提交与推送授权内处理自己的 branch；主 agent 负责复核和落地。PR 写实际行为、精确 head SHA、执行过的检查及限制。GUI 改动按 [record-browser-gif](../record-browser-gif/SKILL.md) 保留真实 branch/server/model 的证据。没有 GUI 行为变化时无需重新录制。

独立 PR 直接指向 main。实际依赖其他 PR 时，先确认仓库支持并按 [merging-stacked-prs](../merging-stacked-prs/SKILL.md) 使用 GitHub 官方 stack。尚未形成 PR stack 且仓库不支持时，安排前置任务先落地，再从更新后的 main 开发后续任务；已有依赖 PR 链的恢复遵循 stack skill 的限制，不用该顺序开发路径绕过它。不要靠未声明 cherry-pick 伪装独立 PR。

主 agent 按 [code-review](../code-review/SKILL.md) 读取 live base/head 和 diff，检查任务间集成。远端没有 CI 时，报告实际本地结果，不写“CI 通过”。合并授权已存在时，检查必需门禁、可合并状态及精确 head；可使用 `gh pr merge --squash --match-head-commit <sha>`，不得绕过分支保护。无自动合并配置不等于无权按既有授权执行检查后的合并。

合并后的 main 需要核对集成影响，覆盖相关检查后再关闭子任务；全部验收完成才关闭 epic。子 agent 可以报告实现完成，但由协调者核验后关闭任务。已实现的方案同步 Notes 和文档；未完成项留在 Beads。

## 退出与恢复

任务完成后的收尾是必做项：停止任务期间自己启动的 server、测试和浏览器进程，确认退出并释放监听端口后清理临时凭据、profile 和持久化目录。将需要保留的 PR 证据和非敏感日志移到工作树外，核对 PR 已合并、提交已推送、工作树无未提交改动，再由协调者从工作树外执行 `git worktree remove <任务路径>`，并用 `git worktree list` 确认已移除。

不因后续任务“可能会用到”而保留已完成任务的 server 或 worktree。未合并提交、脏工作树或仍需保留的证据阻止清理时，先处理并报告具体原因，不使用 `--force` 丢弃内容。不要使用全局 `killall`、`pkill node`、删除其他任务的 worktree 或重置用户未提交改动。关闭 Beads 任务与最终交付时写明 server、浏览器和 worktree 的实际清理结果。

断流后先检查实际 diff、提交、PR 和仍运行的命令，避免重复写入或重复开 PR。需要继续同一 CLI 会话时，从该任务 JSONL 的 `thread.started` 取确切 thread ID，在原 worktree 中恢复；并行场景不用 `resume --last`。进度回传以 Beads 为长期来源，临时日志仅用于诊断。
