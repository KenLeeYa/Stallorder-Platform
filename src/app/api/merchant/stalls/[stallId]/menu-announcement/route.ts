import { randomUUID } from "node:crypto";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { menuAnnouncementSchema, serializeMenuAnnouncement } from "@/lib/menu-announcement";
import { recordAuditEvent } from "@/lib/audit";
import { invalidatePublicMenu } from "@/lib/public-menu";

export async function PATCH(request: Request, context: { params: Promise<{ stallId: string }> }) {
  const { stallId } = await context.params;
  const auth = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!auth.ok) return auth.response;
  if (!validateCsrf(request, auth.principal)) return Response.json({ error: "安全驗證已失效，請重新整理。" }, { status: 403 });
  const body = await readJson(request, auth.requestId);
  if (body.error) return body.error;
  const parsed = menuAnnouncementSchema.safeParse(body.data);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "公告內容不正確。" }, { status: 400 });
  const { expectedRevision, startsAt, endsAt, ...fields } = parsed.data;
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`select id from public.stalls where id = ${stallId}::uuid for update`;
    const current = await tx.stallMenuAnnouncement.findUnique({ where: { stallId } });
    if ((current?.revision ?? null) !== expectedRevision) return null;
    const data = { ...fields, startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null, revision: randomUUID() };
    return tx.stallMenuAnnouncement.upsert({ where: { stallId }, create: { stallId, ...data }, update: data });
  });
  if (!result) return Response.json({ error: "公告已被其他人修改，請重新整理後再編輯。" }, { status: 409 });
  invalidatePublicMenu(stallId);
  await recordAuditEvent({
    organizationId: auth.workspace.id, stallId, actorProfileId: auth.principal.user.id,
    action: "MENU_ANNOUNCEMENT_UPDATED", entityType: "STALL", entityId: stallId, outcome: "SUCCESS",
    requestId: auth.requestId, metadata: { enabled: result.enabled, revision: result.revision },
  });
  return Response.json({ announcement: serializeMenuAnnouncement(result) }, { headers: { "cache-control": "no-store" } });
}
