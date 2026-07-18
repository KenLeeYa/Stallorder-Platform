import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { batchOrderingSchema, orderingStateForBatchAction } from "@/lib/operational-control";
import { prisma } from "@/lib/prisma";
import { invalidatePublicMenus, invalidatePublicQrToken } from "@/lib/public-menu";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_ORDERING",
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
  const parsed = batchOrderingSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "批次操作資料或確認內容不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const allowedStalls = authorization.workspace.stalls.filter((stall) => stall.isActive);
  const allowedIds = new Set(allowedStalls.map((stall) => stall.id));
  if (parsed.data.stallIds.some((stallId) => !allowedIds.has(stallId))) {
    return NextResponse.json(
      { error: "攤位範圍包含未授權或已停用資源。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const targetStalls = allowedStalls.filter((stall) => parsed.data.stallIds.includes(stall.id));
  const nextState = orderingStateForBatchAction(parsed.data.action);
  const action = parsed.data.action === "PAUSE" ? "BATCH_ORDERING_PAUSED" : "BATCH_ORDERING_RESUMED";
  let results;
  try {
    results = await prisma.$transaction(async (transaction) => {
      const updateResult = await transaction.stall.updateMany({
        where: { organizationId, id: { in: parsed.data.stallIds }, isActive: true },
        data: nextState,
      });
      if (updateResult.count !== targetStalls.length) throw new Error("BATCH_SCOPE_CHANGED");

      await transaction.auditLog.create({
        data: {
          organizationId,
          actorProfileId: authorization.principal.user.id,
          action,
          entityType: "ORGANIZATION",
          entityId: organizationId,
          outcome: "SUCCESS",
          requestId: authorization.requestId,
          ipHash: hashClientIp(request),
          beforeJson: {
            stalls: targetStalls.map((stall) => ({
              stallId: stall.id,
              businessStatus: stall.businessStatus,
              orderingEnabled: stall.orderingEnabled,
            })),
          },
          afterJson: {
            stalls: targetStalls.map((stall) => ({ stallId: stall.id, ...nextState })),
          },
          metadata: JSON.stringify({
            stallIds: targetStalls.map((stall) => stall.id),
            previousStates: targetStalls.map((stall) => ({
              stallId: stall.id,
              businessStatus: stall.businessStatus,
              orderingEnabled: stall.orderingEnabled,
            })),
            nextState,
          }),
        },
      });

      return targetStalls.map((stall) => ({
        stallId: stall.id,
        stallName: stall.name,
        success: true,
        ...nextState,
      }));
    });
  } catch (error) {
    logEvent("error", "BATCH_ORDERING_FAILED", {
      requestId: authorization.requestId,
      organizationId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: error instanceof Error && error.message === "BATCH_SCOPE_CHANGED" ? "攤位狀態已變更，請重新整理後再試。" : "目前無法執行批次操作。" },
      { status: error instanceof Error && error.message === "BATCH_SCOPE_CHANGED" ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const qrCodes = await prisma.qrCode.findMany({
    where: { organizationId, stallId: { in: parsed.data.stallIds } },
    select: { token: true },
  });
  invalidatePublicMenus(parsed.data.stallIds);
  for (const qrCode of qrCodes) invalidatePublicQrToken(qrCode.token);

  return NextResponse.json(
    { action: parsed.data.action, updatedCount: results.length, results },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}
