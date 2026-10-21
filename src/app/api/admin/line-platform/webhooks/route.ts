import { z } from "zod";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { lineWebhookManagementCommandSchema } from "@/lib/line-webhook-management-contract";
import { listLegacyWebhookManagement, readLegacyWebhookManagement, manageLegacyWebhook } from "@/server/notifications/line-webhook-management";

const headers = { "cache-control": "no-store" };
export async function GET(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  const id = new URL(request.url).searchParams.get("integrationId");
  if (id !== null && !z.string().uuid().safeParse(id).success) return Response.json({ error: "INVALID_REQUEST" },{ status: 400,headers });
  try { return Response.json(id ? await readLegacyWebhookManagement(id) : await listLegacyWebhookManagement(),{ headers }); }
  catch { return Response.json({ error: "WEBHOOK_READ_NOT_ALLOWED" },{ status: 409,headers }); }
}
export async function POST(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request,authorization.principal)) return Response.json({ error: "CSRF_INVALID" },{ status: 403,headers });
  const body = await readJson(request,authorization.requestId);
  if (body.error) return body.error;
  const parsed = lineWebhookManagementCommandSchema.safeParse(body.data);
  if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" },{ status: 400,headers });
  try { return Response.json(await manageLegacyWebhook(parsed.data,authorization.principal.user.id),{ headers }); }
  catch { return Response.json({ error: "WEBHOOK_OPERATION_NOT_ALLOWED", message: "設定或測試證據已改變。請重新讀取並測試；不會自動套用或啟用通知。" },{ status: 409,headers }); }
}
