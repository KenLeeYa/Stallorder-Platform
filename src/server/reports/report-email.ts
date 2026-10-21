import "server-only";
import { createHash } from "node:crypto";
import type { ReportEnvelope } from "@/lib/report-delivery-contract";

export type ReportProviderOutcome =
  | { kind: "ACCEPTED"; messageId: string }
  | { kind: "SIMULATED"; messageId: string }
  | { kind: "REJECTED"; code: string; retryable: boolean; retryAfterSeconds?: number; grantClosed: true }
  | { kind: "UNKNOWN"; code: string };
export type ReportProviderEvidence = { kind: "UNKNOWN" } | {
  kind: "ACCEPTED" | "SIMULATED" | "REJECTED"; key: string; hash: string; binding: string;
  reference: string; checkedAt: string; grantClosed: boolean; messageId?: string;
};
export function reportProviderBinding() {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "", from = process.env.REPORT_FROM_EMAIL?.trim() ?? "";
  const simulated = process.env.REPORT_DELIVERY_MODE === "simulate" || (!apiKey && process.env.NODE_ENV !== "production");
  return { mode: simulated ? "SIMULATED" as const : "REAL" as const, from,
    binding: createHash("sha256").update(JSON.stringify(["report-email-v1", simulated, from, apiKey])).digest("hex") };
}
export async function sendReportEnvelope(input: { envelope: ReportEnvelope; key: string; hash: string; binding: string }): Promise<ReportProviderOutcome> {
  const current = reportProviderBinding();
  if (current.binding !== input.binding) return { kind: "REJECTED", code: "PROVIDER_BINDING_CHANGED", retryable: false, grantClosed: true };
  if (current.mode === "SIMULATED") return { kind: "SIMULATED", messageId: `simulated:${input.key}` };
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || !current.from) return { kind: "REJECTED", code: "EMAIL_PROVIDER_NOT_CONFIGURED", retryable: false, grantClosed: true };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": input.key },
      body: JSON.stringify(input.envelope), signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    const body: unknown = await response.json();
    if (response.ok && typeof body === "object" && body !== null && "id" in body && typeof body.id === "string" && body.id.length > 0 && body.id.length <= 200) return { kind: "ACCEPTED", messageId: body.id };
    // No reviewed provider guarantee establishes nonacceptance or a safe replay window.
    return { kind: "UNKNOWN", code: "EMAIL_RESPONSE_UNPROVEN" };
  } catch { return { kind: "UNKNOWN", code: "EMAIL_RESPONSE_LOST" }; }
}
export async function reconcileReportProvider(_input: { key: string; hash: string; binding: string }): Promise<ReportProviderEvidence> {
  // Until a fixed, authenticated provider lookup is independently verified, absence is not proof.
  return { kind: "UNKNOWN" };
}
