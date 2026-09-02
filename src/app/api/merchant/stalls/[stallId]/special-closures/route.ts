import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { invalidatePublicMenu } from "@/lib/public-menu";
import { hashClientIp } from "@/lib/security";
import {
  serializeSpecialClosure,
  specialClosureCommandSchema,
} from "@/lib/special-closures";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = specialClosureCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "特殊營業日設定格式不正確。",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.workspace.id;
  const mutation = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id
      from public.stalls
      where id = ${stallId}::uuid
        and organization_id = ${organizationId}::uuid
      for update
    `;

    if (parsed.data.operation === "DELETE") {
      const existing = await transaction.stallSpecialClosure.findFirst({
        where: { id: parsed.data.closureId, organizationId, stallId },
        select: { id: true, startsOn: true, endsOn: true, opensAt: true, closesAt: true, title: true, message: true },
      });
      if (!existing) return { status: "NOT_FOUND" as const };
      await transaction.stallSpecialClosure.delete({ where: { id: existing.id } });
      return { status: "OK" as const, entityId: existing.id, before: serializeSpecialClosure(existing) };
    }

    const startsOn = new Date(`${parsed.data.startsOn}T00:00:00.000Z`);
    const endsOn = new Date(`${parsed.data.endsOn}T00:00:00.000Z`);
    const existing = parsed.data.operation === "UPDATE"
      ? await transaction.stallSpecialClosure.findFirst({
          where: { id: parsed.data.closureId, organizationId, stallId },
          select: { id: true, startsOn: true, endsOn: true, opensAt: true, closesAt: true, title: true, message: true },
        })
      : null;
    if (parsed.data.operation === "UPDATE" && !existing) {
      return { status: "NOT_FOUND" as const };
    }

    const overlap = await transaction.stallSpecialClosure.findFirst({
      where: {
        organizationId,
        stallId,
        ...(parsed.data.operation === "UPDATE" ? { id: { not: parsed.data.closureId } } : {}),
        startsOn: { lte: endsOn },
        endsOn: { gte: startsOn },
      },
      select: { id: true },
    });
    if (overlap) return { status: "CONFLICT" as const };

    const data = {
      startsOn,
      endsOn,
      opensAt: parsed.data.opensAt,
      closesAt: parsed.data.closesAt,
      title: parsed.data.title,
      message: parsed.data.message,
    };
    if (parsed.data.operation === "CREATE") {
      const created = await transaction.stallSpecialClosure.create({
        data: { organizationId, stallId, ...data },
        select: { id: true },
      });
      return { status: "OK" as const, entityId: created.id, before: undefined };
    }

    const updated = await transaction.stallSpecialClosure.update({
      where: { id: parsed.data.closureId },
      data,
      select: { id: true },
    });
    return {
      status: "OK" as const,
      entityId: updated.id,
      before: existing ? serializeSpecialClosure(existing) : undefined,
    };
  });

  if (mutation.status === "NOT_FOUND") {
    return NextResponse.json(
      { error: "找不到這筆特殊營業日設定。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (mutation.status === "CONFLICT") {
    return NextResponse.json(
      { error: "此日期已設定特殊營業時間或店休，請直接修改既有設定。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  invalidatePublicMenu(stallId);
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: parsed.data.operation === "CREATE"
      ? "STALL_SPECIAL_CLOSURE_CREATED"
      : parsed.data.operation === "UPDATE"
        ? "STALL_SPECIAL_CLOSURE_UPDATED"
        : "STALL_SPECIAL_CLOSURE_DELETED",
    entityType: "STALL_SPECIAL_CLOSURE",
    entityId: mutation.entityId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    before: mutation.before,
    after: parsed.data.operation === "DELETE" ? undefined : parsed.data,
  });

  const closures = await prisma.stallSpecialClosure.findMany({
    where: { organizationId, stallId },
    orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }],
    select: { id: true, startsOn: true, endsOn: true, opensAt: true, closesAt: true, title: true, message: true },
  });
  return NextResponse.json(
    { closures: closures.map(serializeSpecialClosure) },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
