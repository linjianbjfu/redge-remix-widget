/** Validate the widget bundle and run extraction and rendering in Browser Run. */
import puppeteer from "@cloudflare/puppeteer";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { WorkspaceFs } from "../fs/workspace-fs.ts";
import { OUT_DIR } from "../shell/bash.ts";
import { parseWidgetMeta, validateWidgetPaths } from "../widget-contract.ts";
import { readCaptureSource } from './capture-source.ts';
import { renderWidgetPreview } from "./preview-render.ts";
import {resolvePreviewMaxCount} from "./preview-policy.ts";

const EXTRACTED_PATH = "/widget-preview-data.json";

export async function previewFiles(fs: WorkspaceFs, fixedCanvas = false) {
  const entries = await fs.readdirWithFileTypes(OUT_DIR);
  validateWidgetPaths(entries.map(entry => `out/${entry.name}`));
  if (entries.some(entry => !entry.isFile)) throw new Error("Widget artifacts must be files");
  const meta = parseWidgetMeta(await fs.readFile(`${OUT_DIR}/meta.json`));
  const size = fixedCanvas ? "fixed" : meta.size;
  const [html, extra, sourceFiles] = await Promise.all([
    fs.readFile(`${OUT_DIR}/widget.html`), fs.readFile(`${OUT_DIR}/extra.js`), readCaptureSource(fs),
  ]);
  return {html, extra, ...sourceFiles, size};
}

export async function renderPreview(browserBinding: BrowserRun, fs: WorkspaceFs, fixedCanvas = false) {
  const files = await previewFiles(fs, fixedCanvas);
  const browser = await puppeteer.launch(browserBinding, { keep_alive: 600_000 });
  try {
    const result = await renderWidgetPreview(browser, files);
    if (result.extractedData !== null) await fs.writeFile(EXTRACTED_PATH, result.extractedData);
    return {...result, sourceMode: files.dom === undefined ? 'legacy HTML (live DOM structure unverified)' : 'captured DOM v2'};
  } finally {
    await browser.disconnect();
  }
}

export function createPreviewTool(browserBinding: BrowserRun, fs: WorkspaceFs, fixedCanvas = false,
  {maxCount, onExhausted, render = renderPreview}: {maxCount?: number; onExhausted?: () => void; render?: typeof renderPreview} = {}) {
  const limit = resolvePreviewMaxCount(maxCount);
  let used = 0;
  return defineTool({
    name: "preview_widget",
    label: "Preview widget",
    description:
      "Check the three out/ artifacts, evaluate extra.js against the paired capture v2 DOM (legacy inputs use HTML parsing) without executing captured scripts, " +
      `serve the result as data.json and wait for widgetReady at ${fixedCanvas ? "the fixed 360x440 canvas" : "the meta.json size"}. Returns loading, syntax/runtime/resource errors, data ` +
      "mismatches, viewport/root bounds, overflow and motion findings, text and a screenshot. Inert captures do not load remote source images; live img-to-base64 extraction needs original-page verification. " +
      `Extracted JSON is saved to ${EXTRACTED_PATH}; read it to check the extractor/renderer data fields. ` +
      `At most ${limit} execution attempts are available in this run, including failures. Finish with available evidence when exhausted.`,
    promptSnippet: `preview_widget — verify data.json loading, extraction and static layout at ${fixedCanvas ? "360x440" : "the selected size"}`,
    parameters: Type.Object({}),
    async execute() {
      if (used >= limit) throw new Error(`preview limit reached (${limit}); finish without further browser checks`);
      const attempt = ++used;
      if (used === limit) onExhausted?.();
      let result;
      try {
        result = await render(browserBinding, fs, fixedCanvas);
      } catch (error) {
        // Pi marks thrown failures as tool errors; an isError return property is ignored.
        throw new Error(`preview failed: ${String(error).split("\n")[0]?.slice(0, 300)}`);
      }
      const valid = result.syntaxError === null && result.errors.length === 0;
      const lines = [
        `preview attempt: ${attempt}/${limit}; remaining: ${limit - used}`,
        ...(used === limit ? ["Browser preview budget exhausted. Complete with available evidence; do not call preview_widget again."] : []),
        `validation: ${valid ? "passed" : "failed"}`,
        `source: ${result.sourceMode}`,
        `size: ${result.size}; viewport: ${result.viewport.width}x${result.viewport.height}; root: ${JSON.stringify(result.root)}`,
        result.syntaxError ? `syntax error in extra.js: ${result.syntaxError}` : "syntax: ok",
        result.errors.length ? `errors:\n${result.errors.join("\n")}` : "errors: none",
        `rendered text: ${result.text.slice(0, 500)}`,
        result.extractedData === null ? "extraction: failed" : `extracted data: ${EXTRACTED_PATH}`,
      ];
      return {
        content: [
          { type: "text" as const, text: lines.join("\n") },
          { type: "image" as const, data: result.screenshotBase64, mimeType: "image/png" },
        ],
        details: { valid },
      };
    },
  });
}
