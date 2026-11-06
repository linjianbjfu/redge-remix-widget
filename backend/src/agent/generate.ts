import type {Env} from "../do/user-agent-do.ts";
import type {WorkspaceFs} from "../fs/workspace-fs.ts";
import type {GenerationRequest, GenerationResult} from "../generation.ts";
import {FIXED_WIDGET} from "../widget-contract.ts";
import {createModelRuntime, resolveProvider} from "./model.ts";
import {openSession} from "./session-factory.ts";
import {resolvePreviewMaxCount} from "./preview-policy.ts";

/** Generate with the existing coding tools; no client history or durable turn is created. */
export async function generateWidget(env: Env, fs: WorkspaceFs, sessionId: string, input: GenerationRequest): Promise<GenerationResult> {
  await fs.mkdir("/out", {recursive: true});
  await fs.writeFile("/source.html", input.htmlContent);
  const provider = resolveProvider(env);
  const opened = await openSession({
    modelRuntime: await createModelRuntime(provider), providerId: provider.id, modelId: provider.defaultModel,
    fs, sessionId, history: [], fixedCanvas: true, previewMaxCount: resolvePreviewMaxCount(env.PREVIEW_MAX_COUNT),
    ...(env.BROWSER ? {browser: env.BROWSER} : {}),
  });
  try {
    const images = input.input_image ? [{type: "image" as const, mimeType: "image/png",
      data: input.input_image.replace(/^data:image\/png;base64,/, "")}] : [];
    await opened.session.prompt(`${input.userQuery}\n\n<source_context>\n${JSON.stringify({url: input.url, pageTitle: input.pageTitle})}\n</source_context>`, {images});
    const [extractScript, widgetHtml] = await Promise.all([fs.readFile("/out/extra.js"), fs.readFile("/out/widget.html")]);
    return {status: "Success", title: input.pageTitle, ...FIXED_WIDGET, extractScript, widgetHtml};
  } finally {
    await opened.session.dispose();
  }
}
