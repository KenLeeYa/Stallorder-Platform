import "server-only";
import { z, ZodError } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp } from "@/lib/security";
import { feedbackCommandSchema, feedbackQuerySchema } from "@/lib/feedback-contract";
import { FeedbackError, getFeedback, listFeedback, submitFeedback, updateFeedback } from "./feedback-service";
export async function feedbackHttp(request: Request, operation: "submit" | "list" | "detail" | "update", id?: string) {
    let requestId = createRequestId();
    const privateResponse = (response: Response) => { response.headers.set("cache-control", "private, no-store"); response.headers.set("x-content-type-options", "nosniff"); return response; };
    const json = (data: unknown, status = 200, headers = {}) => privateResponse(Response.json(data, { status, headers: { "x-request-id": requestId, ...headers } }));
    try {
        const authorization = operation === "submit" ? null : await authorizePlatformAdminApiRequest(request);
        if (authorization && !authorization.ok)
            return privateResponse(authorization.response);
        const principal = authorization?.ok ? authorization.principal : await getRequestPrincipal(request);
        if (authorization?.ok)
            requestId = authorization.requestId;
        if (!principal)
            throw new FeedbackError(401, "FEEDBACK_SESSION_EXPIRED");
        if (["submit", "update"].includes(operation) && !validateCsrf(request, principal))
            throw new FeedbackError(403, "FEEDBACK_CSRF_INVALID");
        const params = new URL(request.url).searchParams;
        if (operation === "submit") {
            if (params.size)
                throw new FeedbackError(400, "FEEDBACK_INPUT_INVALID");
            const body = await readJson(request, requestId, { maxBytes: 12 * 1024 });
            if (body.error)
                return privateResponse(body.error);
            const command = feedbackCommandSchema.parse(body.data);
            for (const budget of [
                { scope: "authenticated-api", identifier: principal.user.id, limit: 300, windowMs: 300000 },
                { scope: "feedback-ip", identifier: hashClientIp(request), limit: 30, windowMs: 3600000 },
                { scope: "feedback-submit", identifier: principal.user.id, limit: 5, windowMs: 3600000 },
            ]) {
                const rate = await checkRateLimit(budget);
                if (!rate.allowed)
                    return json({ code: "RATE_LIMITED", error: "回饋送出過於頻繁，請稍後重試。" }, 429, { "retry-after": String(rate.retryAfterSeconds) });
            }
            return json({ receipt: await submitFeedback(principal, command) }, 201);
        }
        const entries = [...params.entries()];
        if (new Set(entries.map(([key]) => key)).size !== entries.length)
            throw new FeedbackError(400, "FEEDBACK_INPUT_INVALID");
        if (params.has("cursor") && (!params.has("from") || !params.has("to")))
            throw new FeedbackError(400, "FEEDBACK_INPUT_INVALID");
        const now = new Date(), query = feedbackQuerySchema.parse({ from: new Date(now.getTime() - 90 * 86400000).toISOString(), to: now.toISOString(), ...Object.fromEntries(entries) });
        if (operation !== "list")
            z.uuid().parse(id);
        if (operation !== "list" && query.cursor)
            throw new FeedbackError(400, "FEEDBACK_INPUT_INVALID");
        let result: unknown;
        if (operation === "list")
            result = await listFeedback(principal, query);
        else if (operation === "detail")
            result = { item: await getFeedback(principal, id!, query) };
        else {
            const body = await readJson(request, requestId, { maxBytes: 512 });
            if (body.error)
                return privateResponse(body.error);
            result = { item: await updateFeedback(principal, id!, body.data, query) };
        }
        await recordAuditEvent({ action: operation === "update" ? "PRODUCT_FEEDBACK_STATUS_CHANGED" : "PRODUCT_FEEDBACK_READ", entityType: "PRODUCT_FEEDBACK", outcome: "SUCCESS", requestId, actorProfileId: principal.user.id, ...(id ? { entityId: id } : {}) });
        return json(result);
    }
    catch (error) {
        if (error instanceof ZodError)
            return json({ code: "FEEDBACK_INPUT_INVALID", error: "回饋格式不正確，請檢查欄位。" }, 400);
        if (error instanceof FeedbackError)
            return json({ code: error.code, error: error.status === 409 ? "回饋已被更新，請重新讀取後再操作。" : "無法存取回饋，請確認登入與權限。" }, error.status);
        return json({ code: "FEEDBACK_UNAVAILABLE", error: "回饋暫時無法使用，請保留內容並稍後重試。" }, 503);
    }
}
