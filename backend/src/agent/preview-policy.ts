/** Browser-check budget per coding-agent execution. */
export const DEFAULT_PREVIEW_MAX_COUNT = 2;

export function resolvePreviewMaxCount(value: string | number | undefined): number {
  if (value === undefined) return DEFAULT_PREVIEW_MAX_COUNT;
  const count = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("PREVIEW_MAX_COUNT must be a nonnegative integer");
  }
  return count;
}
