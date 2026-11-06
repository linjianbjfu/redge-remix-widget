/** Single-request generation. Request fields and GEC headers are not verified by the server. */
export const GENERATION_PATH = "/v1/generate";
export const GENERATION_POOL_SIZE = 20;
export const NO_CACHE_HEADERS = { "cache-control": "no-store, no-cache, must-revalidate", pragma: "no-cache" };

export interface GenerationRequest {
  userQuery: string;
  url: string;
  pageTitle: string;
  htmlContent: string;
  input_image?: string;
  history: unknown[];
}

export interface GenerationResult {
  status: "Success";
  title: string;
  size: string;
  width: number;
  height: number;
  extractScript: string;
  widgetHtml: string;
}

export function generationObjectName(tick: number): string {
  return `generation-${tick % GENERATION_POOL_SIZE}`;
}
