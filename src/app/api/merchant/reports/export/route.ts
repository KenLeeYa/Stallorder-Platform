import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { cancellationReasonLabels } from "@/lib/cancellation-reasons";
import { createCsv } from "@/lib/csv";
import { validateCsrf } from "@/lib/csrf";
import { dashboardQuerySchema } from "@/lib/dashboard-validation";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getCancellationReasonReport, getCashShiftReport, getPaymentMethodReport } from "@/lib/report-data";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body.error) return body.error;
  const parsed = dashboardQuerySchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "匯出條件不正確。" },
      { status: 400 },
    );
  }

  const authorization = await authorizeOrganizationApiRequest(
    request,
    parsed.data.organizationId,
    "VIEW_REPORTS",
    true,
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  try {
    await entitlementService.assertFeatureEnabled(authorization.workspace.id, "CSV_EXPORT");
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
  const authorizedStallIds = new Set(authorization.authorizedStallIds);
  const availableStalls = authorization.workspace.stalls.filter(
    (stall) => stall.isActive && authorizedStallIds.has(stall.id),
  );
  const requestedIds = parsed.data.stallIds.length > 0
    ? parsed.data.stallIds
    : availableStalls.map((stall) => stall.id);
  const allowedIds = new Set(availableStalls.map((stall) => stall.id));
  if (requestedIds.length === 0 || requestedIds.some((stallId) => !allowedIds.has(stallId))) {
    return NextResponse.json(
      { error: "攤位範圍包含未授權資源。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const [summaries, paymentMethods, cancellationReasons, cashShifts] = await Promise.all([
    prisma.dailyStallSummary.findMany({
      where: {
        organizationId: authorization.workspace.id,
        stallId: { in: requestedIds },
        businessDate: {
          gte: new Date(`${parsed.data.dateFrom}T00:00:00.000Z`),
          lte: new Date(`${parsed.data.dateTo}T00:00:00.000Z`),
        },
      },
      orderBy: [{ businessDate: "asc" }, { stallId: "asc" }],
      include: { stall: { select: { name: true, code: true } } },
    }),
    getPaymentMethodReport(
      authorization.workspace.id,
      requestedIds,
      parsed.data.dateFrom,
      parsed.data.dateTo,
    ),
    getCancellationReasonReport(
      authorization.workspace.id,
      requestedIds,
      parsed.data.dateFrom,
      parsed.data.dateTo,
    ),
    getCashShiftReport(
      authorization.workspace.id,
      requestedIds,
      parsed.data.dateFrom,
      parsed.data.dateTo,
    ),
  ]);

  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      insert into public.usage_events (
        organization_id, stall_id, event_type, quantity, billing_period, reference_id
      )
      select
        ${authorization.workspace.id}::uuid,
        ${requestedIds.length === 1 ? requestedIds[0] : null}::uuid,
        'CSV_EXPORTED',
        1,
        date_trunc('month', now() at time zone organization.default_timezone)::date,
        ${`report-export:${authorization.requestId}`}
      from public.organizations organization
      where organization.id = ${authorization.workspace.id}::uuid
    `;
    await transaction.auditLog.create({
      data: {
        organizationId: authorization.workspace.id,
        stallId: requestedIds.length === 1 ? requestedIds[0] : null,
        actorProfileId: authorization.principal.user.id,
        action: "REPORT_EXPORTED",
        entityType: "REPORT",
        outcome: "SUCCESS",
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
        afterJson: {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          stallIds: requestedIds,
          rowCount: summaries.length + paymentMethods.length + cancellationReasons.length + cashShifts.length,
          format: "CSV",
        },
      },
    });
  });

  const stallCodes = new Map(authorization.workspace.stalls.map((stall) => [stall.id, stall.code]));
  const csv = createCsv([
    [
      "營業日期", "攤位代碼", "攤位", "訂單數", "已確認", "已完成", "已取消",
      "未付款", "總銷售額", "折扣", "淨銷售額", "現金", "人工轉帳", "其他付款", "平均客單價",
    ],
    ...summaries.map((summary) => [
      summary.businessDate.toISOString().slice(0, 10),
      summary.stall.code,
      summary.stall.name,
      summary.orderCount,
      summary.confirmedOrderCount,
      summary.completedOrderCount,
      summary.cancelledOrderCount,
      summary.unpaidOrderCount,
      summary.grossSales,
      summary.discountAmount,
      summary.netSales,
      summary.cashAmount,
      summary.manualTransferAmount,
      summary.otherPaymentAmount,
      summary.averageOrderValue,
    ]),
    [],
    ["付款方式明細"],
    ["攤位代碼", "攤位", "付款方式", "付款筆數", "付款金額"],
    ...paymentMethods.map((payment) => [
      stallCodes.get(payment.stallId) ?? "",
      payment.stallName,
      payment.methodLabel,
      payment.paymentCount,
      payment.amount,
    ]),
    [],
    ["取消原因明細"],
    ["攤位代碼", "攤位", "取消原因", "取消筆數"],
    ...cancellationReasons.map((cancellation) => [
      stallCodes.get(cancellation.stallId) ?? "",
      cancellation.stallName,
      cancellationReasonLabels[cancellation.reason],
      cancellation.count,
    ]),
    [],
    ["現金交班明細"],
    ["攤位代碼", "攤位", "開班時間", "結班時間", "狀態", "開班金額", "現金銷售", "現金退款", "現金收入", "現金支出", "帳務更正", "系統應有", "實際盤點", "短溢收", "開班人員", "結班人員", "最近複核"],
    ...cashShifts.map((shift) => [
      stallCodes.get(shift.stallId) ?? "",
      shift.stallName,
      shift.openedAt.toISOString(),
      shift.closedAt?.toISOString() ?? "",
      shift.status,
      shift.openingAmount,
      shift.cashSales,
      shift.cashRefunds,
      shift.cashIn,
      shift.cashOut,
      shift.corrections,
      shift.expectedAmount,
      shift.actualAmount ?? "",
      shift.differenceAmount ?? "",
      shift.openedByName,
      shift.closedByName ?? "",
      shift.latestReviewDecision ?? "",
    ]),
  ]);
  const filename = `stallorder-report-${parsed.data.dateFrom}-${parsed.data.dateTo}.csv`;
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-request-id": authorization.requestId,
    },
  });
}
