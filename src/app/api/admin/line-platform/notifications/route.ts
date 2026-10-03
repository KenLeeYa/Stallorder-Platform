import { z } from "zod";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { ensurePlatformNotificationIntegration } from "@/server/line-platform/notification-binding";
import { retryPlatformNotification } from "@/server/line-platform/notification-worker";

export async function GET(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (new URL(request.url).searchParams.get("mode") === "LEGACY") {
    const jobs = await prisma.$queryRaw`select j.id::text,j.organization_id::text,j.order_id::text,j.stall_id::text,s.name as stall_name,
      j.template_code,j.outcome,j.attempt_count,j.last_error_code,j.sent_at,j.next_attempt_at
      from public.notification_jobs j join public.stalls s on s.id=j.stall_id
      where j.delivery_mode='LEGACY' order by j.created_at desc limit 100`;
    return Response.json({ mode: "LEGACY", enabled: false, jobs }, { headers: { "cache-control": "no-store" } });
  }
  const config = getLinePlatformRuntime();
  if (!config) return Response.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  const integrations = await prisma.$queryRaw`select id::text,status,quota_limit,quota_usage,quota_checked_at,paused_until,settings_json->>'lastWorkerError' as worker_error from public.notification_integrations where sender_scope='PLATFORM_OA' and environment=${config.environment}`;
  const queue = await prisma.$queryRaw`select stall_id::text,template_code,outcome,count(*)::integer as count,min(created_at) as oldest_at from public.notification_jobs where delivery_mode='PLATFORM_OA' and environment=${config.environment} group by stall_id,template_code,outcome`;
  const jobs = await prisma.$queryRaw`select j.id::text,j.order_id::text,j.stall_id::text,s.name as stall_name,j.template_code,j.outcome,j.attempt_count,j.last_error_code,j.sent_at,j.next_attempt_at
    from public.notification_jobs j join public.stalls s on s.id=j.stall_id where j.delivery_mode='PLATFORM_OA' and j.environment=${config.environment} order by j.created_at desc limit 100`;
  return Response.json({ configured: true,enabled: config.notificationsEnabled,integrations,queue,jobs }, { headers: { "cache-control": "no-store" } });
}
const command = z.discriminatedUnion("operation", [z.object({ operation: z.literal("RECONCILE_LEGACY"),jobId: z.string().uuid(),organizationId: z.string().uuid(),stallId: z.string().uuid() }).strict(), z.object({ operation: z.literal("SYNC_REGISTRY") }).strict(), z.object({ operation: z.literal("RETRY"),jobId: z.string().uuid(),stallId: z.string().uuid(),reason: z.string().trim().min(2).max(200) }).strict()]);
export async function POST(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request,authorization.principal)) return Response.json({ error: "CSRF_INVALID" }, { status: 403 });
  const body = await readJson(request,authorization.requestId);
  if (body.error) return body.error;
  const parsed = command.safeParse(body.data);
  if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  if (parsed.data.operation === "RECONCILE_LEGACY") {
    const input = parsed.data;
    const [job] = await prisma.$queryRaw<Array<{ outcome: string }>>`select outcome from public.notification_jobs
      where id=${input.jobId}::uuid and organization_id=${input.organizationId}::uuid and stall_id=${input.stallId}::uuid
      and delivery_mode='LEGACY' and outcome='MANUAL_REVIEW'`;
    if (!job) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    return Response.json({ state: "EVIDENCE_REQUIRED", outcome: job.outcome, resent: false,
      message: "目前沒有可驗證的服務商查詢證據；保留待人工確認狀態，不會補送。" }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const config = getLinePlatformRuntime();
    if (!config) return Response.json({ error: "NOT_CONFIGURED" }, { status: 409 });
    if (parsed.data.operation === "SYNC_REGISTRY") {
      const integrationId = await prisma.$transaction(async (db) => {
        const id = await ensurePlatformNotificationIntegration(config,db);
        await db.auditLog.create({ data: { actorProfileId: authorization.principal.user.id,action: "LINE_PLATFORM_SENDER_CONFIGURED",entityType: "NOTIFICATION_INTEGRATION",entityId: id,outcome: "SUCCESS",requestId: authorization.requestId,metadata: JSON.stringify({ environment: config.environment }) } });
        return id;
      });
      return Response.json({ integrationId }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json(await retryPlatformNotification(parsed.data.jobId,parsed.data.stallId,parsed.data.reason,authorization.principal.user.id,authorization.requestId), { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "NOTIFICATION_OPERATION_NOT_ALLOWED" }, { status: 409,headers: { "cache-control": "no-store" } }); }
}
