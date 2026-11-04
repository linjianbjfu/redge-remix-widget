# 启动与任务模板

用于本机 `codex exec` 的协调者。执行前读 [skill](../SKILL.md)，按当前 `codex exec --help` 核对参数。CLI 行为参见 [OpenAI 官方非交互模式文档](https://developers.openai.com/codex/noninteractive/)；本机配置和实测结果决定 provider 是否可用。

## Beads 与 worktree

下面各变量由协调者替换为实际任务值；命令示例不是待执行任务清单。

```sh
bd create '需求名称' --type=epic --priority=2 --description='已确认范围与整体验收'
bd create '后端子任务' --type=task --parent="$TASK_EPIC" --description='范围、文件所有权、验收'
bd create '客户端子任务' --type=task --parent="$TASK_EPIC" --description='范围、文件所有权、验收'
# 仅当客户端任务确实依赖后端落地时添加：
bd dep add "$TASK_CLIENT" "$TASK_BACKEND"
bd --actor "$TASK_ACTOR" show "$TASK_ID"
bd --actor "$TASK_ACTOR" update "$TASK_ID" --claim || exit $?
bd --actor "$TASK_ACTOR" show "$TASK_ID"
# 仅在领取成功、assignee 正确且没有未完成 blockers 时继续。
git fetch origin main
git worktree add -b "$TASK_BRANCH" "$TASK_WORKTREE" "$TASK_BASE_SHA"
```

上述领取必须早于工作树创建和 agent 启动；失败就停止该任务的后续命令。子 agent 核对当前任务仍属于自己的 actor，随后在新 worktree 核对 `git status`、适用指令和 `bd where`。依赖安装从该 worktree 的根目录运行；不共用可写的 node_modules 或构建目录。持续工作期间使用同一 actor，按实际租约 TTL 续租：

```sh
bd --actor "$TASK_ACTOR" show "$TASK_ID"
bd --actor "$TASK_ACTOR" heartbeat "$TASK_ID"
```

## 启动独立 Codex

协调者为每个任务准备独立日志目录，写好下节 prompt，并确定权限与有效配置。不要覆盖 `HOME` 或 `CODEX_HOME` 来切换工作目录。

```sh
TASK_LOG_DIR=$(mktemp -d /tmp/webclip-agent.XXXXXX)
# 将已填写的任务 prompt 写入 "$TASK_LOG_DIR/prompt.txt" 后启动。
codex exec -C "$TASK_WORKTREE" \
  -c "model_provider=\"$TASK_PROVIDER\"" \
  -m "$TASK_MODEL" \
  -c "model_reasoning_effort=\"$TASK_REASONING\"" \
  -c "approval_policy=\"$TASK_APPROVAL\"" \
  -s "$TASK_SANDBOX" \
  --json -o "$TASK_LOG_DIR/final.txt" - \
  < "$TASK_LOG_DIR/prompt.txt" \
  > "$TASK_LOG_DIR/events.jsonl" 2> "$TASK_LOG_DIR/stderr.log"
```

2026-10-23 的成功运行使用配置中的 provider `cc`、model `gpt-6-astra`、reasoning `medium`，凭据通过 `cckey` 环境变量提供；当时父环境允许 `approval_policy=never` 和 `danger-full-access`。这些是实测设置，不是固定默认值。下次读取当时的有效配置，不把 provider URL 或令牌复制进 prompt；profile 和项目级覆盖也需核对。

上述命令持续运行：在支持非阻塞执行的工具会话中启动并保存其 session ID，随后以另一工具会话启动下一个任务。普通 shell 可由父进程启动后台 job 并保存 PID、等待退出；不要只启动后就丢失进程管理。`--json` stdout 是事件流，`-o` 单独保存最终消息；最终文件不代替退出码和验证证据。

若原生工具报 `stream disconnected before completion: Response API in-stream error` 且没有执行事件，先核对本地 CLI 能否在相同 provider 下执行一个小任务。该错误本身不能证明模型不支持或 provider 是根因。成功后复用同一路径扩展并行任务。

使用准确 thread ID 恢复，具体位置参数以本机 help 为准：

```sh
(cd "$TASK_WORKTREE" && codex exec resume "$TASK_THREAD_ID" \
  -c "model_provider=\"$TASK_PROVIDER\"" -m "$TASK_MODEL" \
  -c "model_reasoning_effort=\"$TASK_REASONING\"" \
  -c "approval_policy=\"$TASK_APPROVAL\"" \
  -c "sandbox_mode=\"$TASK_SANDBOX\"" \
  --json -o "$TASK_LOG_DIR/resumed-final.txt" - \
  < "$TASK_LOG_DIR/followup.txt" \
  > "$TASK_LOG_DIR/resumed-events.jsonl" 2> "$TASK_LOG_DIR/resumed-stderr.log")
```

恢复前重新核对有效 provider、权限和运行中进程；若本次仍需覆盖配置，按 `resume --help` 传入，不假定新子命令支持 `-C` 或 `-s`。

## 子 agent prompt

把尖括号字段替换为具体值，删掉不适用项；不要向子 agent 传未填充模板。

```text
你是本次并行实现的 <角色>。任务 <Bead ID>；actor <唯一 actor>。
只在 <绝对 worktree> / <branch> 开发，base <SHA>。
共享 Beads 的位置为 <路径>；任务已由主 agent 用上述 actor 原子领取。
首先核对任务 assignee、in_progress 和 blockers；确认归属后才调研代码、规划或实施。
若未领取，先用自己的 actor 原子 --claim；失败就停止任务，不覆盖 assignee 或新建重复任务。
之后读取此 worktree 的 AGENTS.md 和适用 skills；按 TTL heartbeat，失去归属就停止工作。
不要递归启动 agent。

已确认方案：<实际可读路径及关键决定>。
用户已授权：<按本次会话填写实现、commit、push、PR、server、模型调用等>。
未授权部分：<如有>。不要重复申请已有批准，也不要自行扩大权限或范围。

目标与可观察验收：<明确结果>。
你的文件所有权：<目录／文件>。
其他 owner：<主 agent 的共享文件及其他任务的目录>。
跨任务接口：<已确认契约、依赖 ID>。
不要修改其他 worktree；需要跨 owner 改动时写明原因交给协调者。

模拟器／backend：<不需要，或专属 UDID、DerivedData、状态目录、创建规则>。
当前日常设备和 server 不属于你；仅清理自己拥有的资源。
需要原生验收时按 parallel-codex-worktrees skill 启动独立服务及模拟器。
UI 窗口使用权：<领取与释放方式>，不要与其他 agent 同时点击共享窗口。
模型配置通过 <私密配置来源> 读取，禁止输出密钥。

进度写入 Beads 和 <私密日志目录>/progress.txt：变更、阻碍、检查、资源 ID。
运行覆盖 diff 的检查；GUI 行为变化按 record-browser-gif 提供真实流程证据。
一个任务一个 PR，目标 <main 或已声明官方 stack>；用 --body-file 提交 PR 正文。
完成后停止自己启动的 server，确认退出，清理凭据并 shutdown 自己的模拟器。
将需保留的验收证据移到工作树外；报告 PR URL、精确 SHA、实际测试结果、未验证项、资源清理状态。
由主 agent 复核、合并，确认无未提交改动后移除任务 worktree，再关闭 Bead；你不自行 merge。
```
