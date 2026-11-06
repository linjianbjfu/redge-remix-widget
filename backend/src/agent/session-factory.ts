/**
 * Building and restoring a pi session.
 *
 * Context is rebuilt from the event log's `pi_entry` records only. Those
 * records restore pi's `SessionEntry` values, including persisted image bytes,
 * so a restored session produces the same request the live one did — thinking blocks and
 * their signatures included, which is what keeps the upstream prompt cache
 * matching across a restart.
 *
 * The persisted form is a linear sequence while pi's session is a tree, so
 * `parentId` is relinked in order on the way back in. v1 has no branching,
 * which makes a linear relink exact; supporting forks would change this.
 */

import {
  type AgentSession,
  type CreateAgentSessionOptions,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { openCoreSession } from "./session-core.ts";
import { withWorkspaceShellBrief } from "./bash-brief.ts";
import { createWidgetResourceLoader } from "./widget-resources.ts";
import { createPreviewTool } from "./preview.ts";
import { createDesignContextTool } from "./design-context.ts";
import { createWorkspaceOperations } from "./operations.ts";
import { WORKSPACE_ROOT, OUT_DIR, createShell } from "../shell/bash.ts";
import type { WorkspaceFs } from "../fs/workspace-fs.ts";
import {resolvePreviewMaxCount} from "./preview-policy.ts";

export interface OpenSessionInput {
  modelRuntime: ModelRuntime;
  providerId: string;
  modelId: string;
  fs: WorkspaceFs;
  sessionId: string;
  /** Raw pi entries in seq order. Empty for a new session. */
  history: readonly unknown[];
  /** Browser Run binding. Without it `preview_widget` is not offered at all. */
  browser?: BrowserRun;
  /** Single-request generation always uses the 360×440 canvas. */
  fixedCanvas?: boolean;
  /** Maximum preview attempts in this run; 0 disables the tool. Defaults to 2. */
  previewMaxCount?: number;
}

export interface OpenedSession {
  session: AgentSession;
  manager: SessionManager;
  /**
   * Entries already durable at open time.
   *
   * Opening a session makes pi write `model_change` and `thinking_level_change`
   * bootstrap entries into a fresh manager. A new session must persist them —
   * they are where the model and thinking level come back from — while a
   * restored one must skip them. A cursor fixed at zero duplicates them on
   * every restore; one fixed at the current length never stores them at all,
   * and the restored session silently falls back to defaults.
   */
  persistedEntries: number;
  briefed: boolean;
}

export async function openSession(input: OpenSessionInput): Promise<OpenedSession> {
  const shell = createShell(input.fs);
  const operations = createWorkspaceOperations(input.fs, shell);

  const model = input.modelRuntime.getModel(input.providerId, input.modelId);
  if (!model) throw new Error(`model ${input.providerId}/${input.modelId} is not registered`);
  const previewMaxCount = resolvePreviewMaxCount(input.previewMaxCount);
  const effectivePreviewMaxCount = input.browser ? previewMaxCount : 0;
  let opened: Awaited<ReturnType<typeof openCoreSession>> | undefined;

  // The `*Operations` seam is reached through each tool's definition factory,
  // and those definitions are registered as `customTools`. A same-named custom
  // tool replaces the built-in, so pi keeps its own argument validation,
  // truncation and diffing while the IO is ours. Passing operations to
  // `createAgentSession` directly does nothing: the built-ins stay in place and
  // reach for the local filesystem and `child_process.spawn`.
  const customTools = [
    createDesignContextTool(undefined, input.fixedCanvas),
    // Offered only when the binding exists: a tool the model can call but
    // that always fails is worse than one it never sees.
    ...(input.browser && effectivePreviewMaxCount > 0 ? [createPreviewTool(input.browser, input.fs, input.fixedCanvas, {
      maxCount: effectivePreviewMaxCount,
      onExhausted: () => {
        const session = opened?.session;
        if (session) session.setActiveToolsByName(session.getActiveToolNames().filter(name => name !== "preview_widget"));
      },
    })] : []),
    withWorkspaceShellBrief(
      createBashToolDefinition(WORKSPACE_ROOT, { operations: operations.bash }),
    ),
    createReadToolDefinition(WORKSPACE_ROOT, { operations: operations.read }),
    createEditToolDefinition(WORKSPACE_ROOT, { operations: operations.edit }),
    createWriteToolDefinition(WORKSPACE_ROOT, { operations: operations.write }),
    createLsToolDefinition(WORKSPACE_ROOT, { operations: operations.ls }),
    createFindToolDefinition(WORKSPACE_ROOT, { operations: operations.find }),
  ];

  opened = await openCoreSession({
    cwd: WORKSPACE_ROOT,
    model,
    modelRuntime: input.modelRuntime,
    resourceLoader: await createWidgetResourceLoader({
      sessionId: input.sessionId,
      workspaceRoot: WORKSPACE_ROOT,
      outDir: OUT_DIR,
      ...(input.fixedCanvas ? {fixedCanvas: true} : {}),
      previewMaxCount: effectivePreviewMaxCount,
    }),
    // SDK renderer generics are contravariant; keep this cast local to the tool list.
    customTools: customTools as NonNullable<CreateAgentSessionOptions["customTools"]>,
  }, input.history);
  return opened;
}
