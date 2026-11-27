import "server-only";
import { randomUUID } from "node:crypto";
import { apiErrorSchema } from "@/lib/operations-read-contract";

export function operationsReadFailure(status: number, requestId: string = randomUUID(), retryAfter?: string | null) {
  const code = status === 400 ? "INVALID_INPUT" : status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 429 ? "RATE_LIMITED" : "READ_FAILED";
  const message = status === 400 ? "篩選條件不正確。" : status === 401 ? "請先登入。" : [403, 404].includes(status) ? "無法存取指定資料。" : status === 429 ? "操作過於頻繁，請等待後重試。" : "資料讀取失敗，請稍後重試。";
  return Response.json(apiErrorSchema.parse({ version: "v1", code, message, requestId, retryable: status >= 500 || status === 429 }), { status, headers: { "cache-control": "private, no-store", "x-request-id": requestId, ...(retryAfter ? { "retry-after": retryAfter } : {}) } });
}
export function operationsAuthorizationFailure(response: Response) { return operationsReadFailure(response.status, response.headers.get("x-request-id") ?? randomUUID(), response.headers.get("retry-after")); }
export function operationsReadResponse(value: unknown, requestId: string) { return Response.json(value, { headers: { "cache-control": "private, no-store", "x-request-id": requestId } }); }
