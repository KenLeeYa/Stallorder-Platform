import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createStallSchema } from "@/lib/stall-validation";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_ORGANIZATION",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = createStallSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "攤位資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const stall = await prisma.$transaction(async (transaction) => transaction.stall.create({
      data: {
        organizationId,
        ...parsed.data,
        location: parsed.data.address,
        orderingSettings: { create: { organizationId } },
        qrCodes: {
          create: {
            organizationId,
            token: randomBytes(32).toString("base64url"),
            label: "主要點餐 QR v1",
          },
        },
      },
      select: { id: true, name: true, slug: true, code: true },
    }));

    await recordAuditEvent({
      organizationId,
      stallId: stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "STALL_CREATED",
      entityType: "STALL",
      entityId: stall.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      metadata: { name: stall.name, code: stall.code },
    });
    return NextResponse.json(
      { stall },
      { status: 201, headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json(
      { error: conflict ? "攤位代碼或網址代稱已被使用。" : "目前無法建立攤位。" },
      { status: conflict ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
