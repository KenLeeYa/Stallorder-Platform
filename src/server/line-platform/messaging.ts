import "server-only";
import { createHash } from "node:crypto";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";

export type PushOperation = { body: string; payloadHash: string; retryKey: string; firstRequestAt: Date };
export type PushResult = {
  outcome: "PROVIDER_ACCEPTED" | "RETRY_SCHEDULED" | "FAILED" | "MANUAL_REVIEW" | "QUOTA_BLOCKED";
  errorCode?: string; requestId?: string | null; acceptedRequestId?: string | null;
};
export const platformPayloadHash = (body: string) => createHash("sha256").update(body).digest("hex");

export async function verifyPlatformBotIdentity(token: string, destination: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl("https://api.line.me/v2/bot/info", { headers: { authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("PLATFORM_SENDER_UNVERIFIED");
  const info: unknown = JSON.parse(await readBoundedText(response, 4096));
  if (!info || typeof info !== "object" || !("userId" in info) || info.userId !== destination) throw new Error("PLATFORM_SENDER_MISMATCH");
}

/** The durable worker persists the exact body and firstRequestAt before this boundary. */
export async function pushPlatformSnapshot(operation: PushOperation, token: string, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<PushResult> {
  if (platformPayloadHash(operation.body) !== operation.payloadHash || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation.retryKey)) {
    return { outcome: "MANUAL_REVIEW", errorCode: "SNAPSHOT_MISMATCH" };
  }
  if (now.getTime() - operation.firstRequestAt.getTime() >= 86_400_000 || now < operation.firstRequestAt) {
    return { outcome: "MANUAL_REVIEW", errorCode: "RETRY_WINDOW_EXPIRED" };
  }
  let response: Response;
  try {
    response = await fetchImpl("https://api.line.me/v2/bot/message/push", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-line-retry-key": operation.retryKey },
      body: operation.body,
    });
  } catch { return { outcome: "RETRY_SCHEDULED", errorCode: "LINE_RESULT_UNKNOWN" }; }
  const requestId = response.headers.get("x-line-request-id");
  if (response.ok) return { outcome: "PROVIDER_ACCEPTED", requestId, acceptedRequestId: requestId };
  const acceptedRequestId = response.headers.get("x-line-accepted-request-id");
  let message = "";
  try {
    const parsed: unknown = JSON.parse(await readBoundedText(response, 16_384));
    if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") message = parsed.message;
  } catch { /* Never persist a provider body or treat an unreadable conflict as success. */ }
  if (response.status === 409 && acceptedRequestId && message === "The retry key is already accepted") {
    return { outcome: "PROVIDER_ACCEPTED", requestId, acceptedRequestId };
  }
  if (response.status === 429) {
    return { outcome: /monthly limit|quota/i.test(message) ? "QUOTA_BLOCKED" : "RETRY_SCHEDULED", requestId,
      errorCode: /monthly limit|quota/i.test(message) ? "LINE_QUOTA_EXHAUSTED" : "LINE_RATE_LIMITED" };
  }
  return { outcome: response.status >= 500 || response.status === 408 ? "RETRY_SCHEDULED" : "FAILED", requestId, errorCode: `LINE_HTTP_${response.status}` };
}

export async function readPlatformQuota(token: string, fetchImpl: typeof fetch = fetch) {
  const values = await Promise.all(["quota", "quota/consumption"].map(async (path) => {
    const response = await fetchImpl(`https://api.line.me/v2/bot/message/${path}`, { headers: { authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("LINE_QUOTA_UNAVAILABLE");
    return JSON.parse(await readBoundedText(response, 4096)) as { type?: string; value?: number; totalUsage?: number };
  }));
  if (!["limited","none"].includes(values[0].type ?? "")) throw new Error("LINE_QUOTA_INVALID");
  const limit = values[0].type === "limited" ? values[0].value : null;
  const usage = values[1].totalUsage;
  if ((limit !== null && (!Number.isSafeInteger(limit) || limit! < 0)) || !Number.isSafeInteger(usage) || usage! < 0) throw new Error("LINE_QUOTA_INVALID");
  return { limit: limit ?? null, usage: usage! };
}
