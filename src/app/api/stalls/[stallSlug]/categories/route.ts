import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeCatalogMutation } from "@/lib/catalog-api";
import { categoryInputSchema } from "@/lib/catalog-validation";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeCatalogMutation(request, stallSlug, "PRODUCT_CATEGORY");
  if (!authorization.ok) return authorization.response;

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = categoryInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "分類資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const category = await prisma.productCategory.create({
      data: {
        ...parsed.data,
        tenantId: authorization.stall.merchantId,
        stallId: authorization.stall.id,
      },
    });
    await recordAuditEvent({
      action: "PRODUCT_CATEGORY_CREATED",
      entityType: "PRODUCT_CATEGORY",
      entityId: category.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorUserId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { category },
      { status: 201, headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "此分類名稱已存在。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }
    throw error;
  }
}
