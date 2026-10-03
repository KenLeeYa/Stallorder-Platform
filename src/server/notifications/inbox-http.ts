import "server-only";
import { ZodError, z } from "zod";
import { getRequestPrincipal, type SessionPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { recordAuditEvent } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId } from "@/lib/security";
import { inboxQuerySchema, inboxScopeSchema, type InboxRef } from "@/lib/notification-inbox-contract";
import { getInboxItem, getInboxPreferences, InboxError, listInbox, markInboxRead, setInboxPreferences } from "./inbox-service";

export function parseInboxSearch(params: URLSearchParams, list = false) {
  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new InboxError(400, "INBOX_QUERY_INVALID");
  const values = Object.fromEntries(entries);
  const scopeFields = ["kind", "organizationId", "applicationId", "stallSlug"];
  const scope = inboxScopeSchema.parse(Object.fromEntries(entries.filter(([key]) => scopeFields.includes(key))));
  if (!list) {
    if (entries.some(([key]) => !scopeFields.includes(key))) throw new InboxError(400, "INBOX_QUERY_INVALID");
    return { scope };
  }
  const rest = Object.fromEntries(entries.filter(([key]) => !scopeFields.includes(key)));
  if (values.unreadOnly !== undefined && !["true", "false"].includes(values.unreadOnly)) throw new InboxError(400, "INBOX_QUERY_INVALID");
  return inboxQuerySchema.parse({ ...rest, scope, ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}), ...(values.unreadOnly !== undefined ? { unreadOnly: values.unreadOnly === "true" } : {}) });
}
type Operation = "list" | "count" | "detail" | "read" | "preferences";
export async function inboxHttp(request: Request, operation: Operation, ref?: InboxRef) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  return authenticatedInboxHttp(request, operation, ref, principal, requestId, true);
}
export async function authenticatedInboxHttp(request: Request, operation: Operation, ref: InboxRef | undefined, principal: SessionPrincipal | null, requestId: string, cookieTransport: boolean) {
  const headers = { "cache-control": "private, no-store", "x-request-id": requestId };
  const json = (value: unknown, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
  try {
    if (!principal) throw new InboxError(401, "INBOX_SESSION_EXPIRED");
    const rate = await checkRateLimit({ scope: "authenticated-api", identifier: principal.user.id, limit: 300, windowMs: 300_000 });
    if (!rate.allowed) return json({ version: "v1", code: "RATE_LIMITED", message: "操作過於頻繁，請稍後重試。", requestId }, 429, { "retry-after": String(rate.retryAfterSeconds) });
    if (cookieTransport && request.method === "PATCH" && !validateCsrf(request, principal)) throw new InboxError(403, "INBOX_CSRF_INVALID");
    const params = new URL(request.url).searchParams;
    if (operation === "preferences") {
      if (params.size) throw new InboxError(400, "INBOX_QUERY_INVALID");
      if (request.method === "GET") return json({ version: "v1", preferences: await getInboxPreferences(principal) });
      const body = await readJson(request, requestId, { maxBytes: 2048 });
      if (body.error) { body.error.headers.set("cache-control", "private, no-store"); return body.error; }
      return json({ version: "v1", preferences: await setInboxPreferences(principal, body.data, cookieTransport ? 1 : 2) });
    }
    const input = parseInboxSearch(params, operation === "list" || operation === "count");
    if (operation === "list" || operation === "count") {
      const result = await listInbox(principal, input);
      return json(operation === "count" ? { version: "v1", unreadCount: result.unreadCount, from: result.from, to: result.to } : result);
    }
    if (!ref) throw new InboxError(400, "INBOX_REFERENCE_INVALID");
    if (operation === "read") {
      const body = await readJson(request, requestId, { maxBytes: 256 });
      if (body.error) { body.error.headers.set("cache-control", "private, no-store"); return body.error; }
      z.object({}).strict().parse(body.data);
      return json({ version: "v1", ...await markInboxRead(principal, input.scope, ref) });
    }
    return json({ version: "v1", item: await getInboxItem(principal, input.scope, ref) });
  } catch (error) {
    if (error instanceof ZodError) return json({ version: "v1", code: "INBOX_INPUT_INVALID", message: "通知查詢或設定格式不正確。", requestId }, 400);
    if (error instanceof InboxError) return json({ version: "v1", code: error.code, message: error.status === 409 ? "偏好已被另一個畫面更新，請重新讀取後再儲存。" : error.status === 400 ? "通知查詢格式不正確。" : "無法存取通知，請確認登入及目前權限。", requestId }, error.status);
    if (principal) try { await recordAuditEvent({ action: "NOTIFICATION_REQUEST_FAILED", entityType: "NOTIFICATION_INBOX", outcome: "FAILURE", requestId, actorProfileId: principal.user.id }); } catch { /* Keep the original retryable failure when audit storage also fails. */ }
    return json({ version: "v1", code: "INBOX_UNAVAILABLE", message: "通知暫時無法使用，請稍後重試。", requestId }, 503);
  }
}
