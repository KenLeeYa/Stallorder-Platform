import { z } from "zod";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { retryPlatformNotification } from "@/server/line-platform/notification-worker";
type Context = { params: Promise<{ stallId: string }> };
export async function GET(request: Request,context: Context) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request,stallId,"MANAGE_LINE_INTEGRATION");
  if (!authorization.ok) return authorization.response;
  const jobs = await prisma.$queryRaw`select id::text,order_id::text,template_code,outcome,attempt_count,last_error_code,sent_at,next_attempt_at from public.notification_jobs
    where organization_id=${authorization.workspace.id}::uuid and stall_id=${stallId}::uuid and delivery_mode='PLATFORM_OA' order by created_at desc limit 100`;
  return Response.json({ jobs }, { headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request,context: Context) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request,stallId,"MANAGE_LINE_INTEGRATION");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request,authorization.principal)) return Response.json({ error: "CSRF_INVALID" }, { status: 403 });
  const body = await readJson(request,authorization.requestId);
  if (body.error) return body.error;
  const parsed = z.object({ jobId: z.string().uuid(),reason: z.string().trim().min(2).max(200) }).strict().safeParse(body.data);
  if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  try { return Response.json(await retryPlatformNotification(parsed.data.jobId,stallId,parsed.data.reason,authorization.principal.user.id,authorization.requestId), { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ error: "NOTIFICATION_RETRY_NOT_ALLOWED" }, { status: 409 }); }
}
