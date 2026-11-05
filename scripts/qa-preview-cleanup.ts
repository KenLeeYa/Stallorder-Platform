type Cleanup = Record<"order" | "browser" | "fixture" | "database", () => Promise<unknown>>;

export function previewQaFailure(error: unknown): Error {
  return error instanceof Error ? error : new Error("PREVIEW_PUBLIC_ORDER_BROWSER_QA_FAILED");
}

// Cleanup failures must not hide the original acceptance failure. All cleanup
// steps still run; only fixed step names are attached to the final error.
export async function finishPreviewQa(failure: Error | undefined, cleanup: Cleanup) {
  const failed: Array<keyof Cleanup> = [];
  for (const step of ["order", "browser", "fixture", "database"] as const) {
    try { await cleanup[step](); } catch { failed.push(step); }
  }
  if (failure || failed.length) {
    const error = failure instanceof Error ? failure : new Error("PREVIEW_ORDER_QA_CLEANUP_FAILED");
    Object.assign(error, { previewCleanupFailures: failed });
    throw error;
  }
}
