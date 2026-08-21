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
  let entityId = stallId;
  if (parsed.data.operation === "CREATE") {
    const closure = await prisma.stallSpecialClosure.create({
      data: {
        organizationId,
        stallId,
        startsOn: new Date(`${parsed.data.startsOn}T00:00:00.000Z`),
        endsOn: new Date(`${parsed.data.endsOn}T00:00:00.000Z`),
        title: parsed.data.title,
        message: parsed.data.message,
      },
      select: { id: true },
    });
    entityId = closure.id;
  } else {
    const closure = await prisma.stallSpecialClosure.findFirst({
      where: { id: parsed.data.closureId, organizationId, stallId },
      select: { id: true },
    });
    if (!closure) {
      return NextResponse.json(
        { error: "找不到這筆特殊營業日設定。" },
        { status: 404, headers: { "x-request-id": authorization.requestId } },
      );
    }
    await prisma.stallSpecialClosure.delete({ where: { id: closure.id } });
    entityId = closure.id;
  }

  invalidatePublicMenu(stallId);
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: parsed.data.operation === "CREATE"
      ? "STALL_SPECIAL_CLOSURE_CREATED"
      : "STALL_SPECIAL_CLOSURE_DELETED",
    entityType: "STALL_SPECIAL_CLOSURE",
    entityId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    after: parsed.data,
  });

  const closures = await prisma.stallSpecialClosure.findMany({
    where: { organizationId, stallId },
    orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }],
    select: { id: true, startsOn: true, endsOn: true, title: true, message: true },
  });
  return NextResponse.json(
    { closures: closures.map(serializeSpecialClosure) },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
