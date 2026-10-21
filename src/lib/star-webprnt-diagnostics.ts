import { csrfHeaders } from "@/lib/csrf-client";
import { StarWebPrntError } from "@/lib/star-webprnt-client";

// Reports are best-effort and bounded; they must never block printing recovery.
const lastReports = new Map<string, number>();

export function reportStarWebPrntFailure(
  stallSlug: string,
  printerId: string,
  phase: "PROBE" | "PRINT" | "TEST" | "DRAWER",
  error: unknown,
) {
  if (!(error instanceof StarWebPrntError)) return;
  const now = Date.now();
  for (const [key, at] of lastReports) if (now - at >= 60_000) lastReports.delete(key);
  const key = JSON.stringify([stallSlug, printerId, phase, error.code, error.diagnostics]);
  if (lastReports.has(key)) return;
  lastReports.set(key, now);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  void fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/print-jobs`, {
    method: "POST", headers: csrfHeaders(), signal: controller.signal,
    body: JSON.stringify({ operation: "WEBPRNT_DIAGNOSTIC", printerId, phase, code: error.code, ...error.diagnostics }),
  }).catch(() => { /* No replay, no success acknowledgement, no receipt data. */ })
    .finally(() => clearTimeout(timer));
}
