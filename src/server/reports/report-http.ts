import "server-only";
import { z, ZodError } from "zod";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hasPermission } from "@/lib/rbac";
import { reportScheduleAccessScope } from "@/lib/report-schedule-access";
import { createRequestId, getSessionDeviceId } from "@/lib/security";
import { ReportExecutionError } from "@/lib/report-delivery-contract";
import { getReportDelivery, listReportDeliveries, reconcileReportDelivery, retryReportDelivery } from "./report-operations";

export async function reportHttp(request: Request, operation: "list" | "detail" | "retry" | "reconcile", organizationId: string, deliveryId?: string) {
  const requestId = createRequestId(), headers = { "cache-control": "private, no-store", "x-request-id": requestId };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  try {
    z.uuid().parse(organizationId);
    const mutate = operation === "retry" || operation === "reconcile";
    const authorization = await authorizeOrganizationApiRequest(request, organizationId, mutate ? "MANAGE_REPORT_SCHEDULES" : "VIEW_REPORTS", true, requestId);
    if (!authorization.ok) { authorization.response.headers.set("cache-control", "private, no-store"); return authorization.response; }
    if (mutate && !validateCsrf(request, authorization.principal)) throw new ReportExecutionError("REPORT_CSRF_INVALID", 403);
    const access = { ...reportScheduleAccessScope(authorization), organizationId, actorId: authorization.principal.user.id, sessionId: authorization.principal.sessionId, deviceId: getSessionDeviceId(request), requestId, canManage: authorization.workspace.roles.some(role => hasPermission(role, "MANAGE_REPORT_SCHEDULES")), isPlatformAdmin: authorization.principal.user.platformRole === "PLATFORM_ADMIN" };
    const entries = [...new URL(request.url).searchParams.entries()];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new ReportExecutionError("REPORT_QUERY_INVALID", 400);
    if (operation === "list") {
      const params = Object.fromEntries(entries);
      return json(await listReportDeliveries(access, { ...params, ...(params.limit === undefined ? {} : { limit: Number(params.limit) }) }));
    }
    if (entries.length || !deliveryId) throw new ReportExecutionError("REPORT_QUERY_INVALID", 400);
    if (!mutate) return json({ version: "v1", item: await getReportDelivery(access, deliveryId) });
    const body = await readJson(request, requestId, { maxBytes: 1024 });
    if (body.error) { body.error.headers.set("cache-control", "private, no-store"); return body.error; }
    const item = operation === "retry" ? await retryReportDelivery(access, deliveryId, body.data) : await reconcileReportDelivery(access, deliveryId, body.data);
    return json({ version: "v1", item });
  } catch (error) {
    if (error instanceof ZodError) return json({ version: "v1", code: "REPORT_INPUT_INVALID", message: "報表查詢或操作格式不正確。", requestId }, 400);
    if (error instanceof ReportExecutionError) return json({ version: "v1", code: error.code, message: error.code === "REPORT_VERSION_STALE" ? "工作已更新，請重新讀取後再操作。" : error.code === "REPORT_RECONCILIATION_UNPROVEN" ? "尚無可信的供應商結果，工作維持未知且不會重新寄送。" : "目前無法執行此操作，請確認權限及工作狀態。", requestId }, error.status);
    return json({ version: "v1", code: "REPORT_UNAVAILABLE", message: "報表工作暫時無法讀取，請稍後重試。", requestId }, 503);
  }
}
