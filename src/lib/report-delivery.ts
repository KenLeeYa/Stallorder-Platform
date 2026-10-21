import "server-only";

import type { PaymentMethod, ReportSchedule, ReportScheduleType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { reportEnvelopeSchema, reportIntentSchema, ReportExecutionError } from "@/lib/report-delivery-contract";
import { claimReportDeliveries, recoverReportDeliveries, createReportIntent, lockReportClaim, assertCurrentReportEligibility, authorizeReportEffect, type ReportClaim } from "@/server/reports/report-execution";
import { reportProviderBinding, sendReportEnvelope, type ReportProviderOutcome } from "@/server/reports/report-email";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  nextScheduledRun,
  reportPeriodForRun,
  reportScheduleTypeLabels,
  type ScheduledReportType,
} from "@/lib/report-scheduling";
import { getPaymentMethodReport, sumPaidAmountByMethod } from "@/lib/report-data";

type CashVarianceRow = {
  stall_id: string;
  stall_name: string;
  closed_at: Date;
  system_expected_amount: number;
  counted_amount: number;
  variance_amount: number;
};

type ReportPayload = {
  organizationName: string;
  reportType: ScheduledReportType;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totals: {
    orderCount: number;
    completedOrderCount: number;
    cancelledOrderCount: number;
    netSales: number;
    discountAmount: number;
    cashAmount: number;
    paymentVariance: number;
  };
  stalls: Array<{
    stallName: string;
    orderCount: number;
    completedOrderCount: number;
    cancelledOrderCount: number;
    netSales: number;
  }>;
  payments: Array<{
    stallName: string;
    method: PaymentMethod;
    methodLabel: string;
    paymentCount: number;
    amount: number;
  }>;
  variances: Array<{
    stallName: string;
    closedAt: string;
    expectedAmount: number;
    countedAmount: number;
    varianceAmount: number;
  }>;
};

export async function processDueReportSchedules(now = new Date(), limit = 20, requestId: string = randomUUID()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ReportExecutionError("REPORT_BATCH_LIMIT_INVALID", 400);
  await recoverReportDeliveries();
  const schedules = await prisma.reportSchedule.findMany({
    where: { isEnabled: true, archivedAt: null, nextRunAt: { lte: now } },
    include: { organization: { select: { businessName: true } } }, orderBy: { nextRunAt: "asc" }, take: limit,
  });
  for (const schedule of schedules) {
    const scheduledFor = schedule.nextRunAt, period = reportPeriodForRun(schedule.reportType, scheduledFor, schedule.timezone), id = randomUUID();
    await prisma.$transaction(async tx => {
      const result = await tx.reportSchedule.updateMany({ where: { id: schedule.id, isEnabled: true, archivedAt: null, nextRunAt: scheduledFor }, data: { nextRunAt: nextScheduledRun(scheduleTime(schedule), scheduledFor), lastRunAt: scheduledFor } });
      if (result.count !== 1) return;
      await tx.reportDelivery.create({ data: {
        id, organizationId: schedule.organizationId, reportScheduleId: schedule.id, reportType: schedule.reportType,
        status: "PROCESSING", scheduledFor, periodStart: new Date(period.periodStart), periodEnd: new Date(period.periodEnd),
        recipients: schedule.recipients, subject: reportSubject(schedule.organization.businessName, schedule.reportType, period.periodStart, period.periodEnd),
        attemptCount: 0, effectState: "NOT_STARTED", nextAttemptAt: now, intentJson: createReportIntent(schedule, id), originRequestId: requestId,
      } });
    });
  }
  const claims = await claimReportDeliveries(limit);
  return Promise.all(claims.map(processClaimedReport));
}

export async function createTestReportDelivery(scheduleId: string, organizationId: string, now = new Date(), requestId: string = randomUUID()) {
  const schedule = await prisma.reportSchedule.findFirst({ where: { id: scheduleId, organizationId, archivedAt: null, isEnabled: true }, include: { organization: { select: { businessName: true } } } });
  if (!schedule) throw new Error("REPORT_SCHEDULE_NOT_FOUND");
  const period = reportPeriodForRun(schedule.reportType, now, schedule.timezone), id = randomUUID();
  await prisma.reportDelivery.create({ data: {
    id, organizationId, reportScheduleId: schedule.id, reportType: schedule.reportType, status: "PROCESSING", scheduledFor: now,
    periodStart: new Date(period.periodStart), periodEnd: new Date(period.periodEnd), recipients: schedule.recipients,
    subject: "[測試] " + reportSubject(schedule.organization.businessName, schedule.reportType, period.periodStart, period.periodEnd),
    attemptCount: 0, effectState: "NOT_STARTED", nextAttemptAt: now, intentJson: createReportIntent(schedule, id), originRequestId: requestId,
  } });
  return processReportDelivery(id);
}

export async function processReportDelivery(deliveryId: string) {
  const [claim] = await claimReportDeliveries(1, deliveryId);
  if (!claim) throw new ReportExecutionError("REPORT_DELIVERY_NOT_PROCESSABLE");
  return processClaimedReport(claim);
}

export async function processClaimedReport(claim: ReportClaim) {
  let effectClaim: ReportClaim | undefined;
  try {
    let delivery = await prisma.$transaction(async tx => { const row = await lockReportClaim(tx, claim); await assertCurrentReportEligibility(tx, row); return row; });
    const intent = reportIntentSchema.parse(delivery.intentJson);
    if (!delivery.snapshotJson) {
      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: delivery.organizationId } });
      const payload = await buildReportPayload({ organizationId: delivery.organizationId, organizationName: organization.businessName, currency: organization.defaultCurrency,
        reportType: delivery.reportType, stallIds: intent.stallIds, periodStart: delivery.periodStart.toISOString().slice(0, 10), periodEnd: delivery.periodEnd.toISOString().slice(0, 10) });
      const content = renderReport(payload), envelope = { from: reportProviderBinding().from, to: delivery.recipients, subject: delivery.subject, ...content };
      const snapshot = JSON.stringify({ version: 1, intent, envelope, payload });
      delivery = await prisma.$transaction(async tx => {
        await lockReportClaim(tx, claim);
        await tx.$executeRaw(Prisma.sql`update public.report_deliveries set snapshot_json=${snapshot}::jsonb,snapshot_hash=encode(extensions.digest((${snapshot}::jsonb)::text,'sha256'),'hex'),payload=${JSON.stringify(payload)}::jsonb,updated_at=clock_timestamp() where id=${claim.id}::uuid and snapshot_json is null`);
        return tx.reportDelivery.findUniqueOrThrow({ where: { id: claim.id } });
      });
    }
    const snapshot = delivery.snapshotJson as { envelope: unknown };
    const envelope = reportEnvelopeSchema.parse(snapshot.envelope);
    effectClaim = await authorizeReportEffect(claim, delivery.snapshotHash!);
    const outcome = await sendReportEnvelope({ envelope, key: intent.key, hash: delivery.snapshotHash!, binding: intent.binding });
    return completeReportEffect(effectClaim, outcome);
  } catch (error) {
    if (error instanceof ReportExecutionError && error.code === "REPORT_LEASE_STALE") throw error;
    if (effectClaim) return completeReportEffect(effectClaim, { kind: "UNKNOWN", code: "EFFECT_OUTCOME_UNKNOWN" });
    await prisma.$transaction(async tx => {
      await lockReportClaim(tx, claim);
      await tx.reportDelivery.update({ where: { id: claim.id }, data: { status: "FAILURE", effectState: "SUPPRESSED", errorCode: "REPORT_PRE_EFFECT_DENIED", nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, executionVersion: { increment: 1 } } });
    });
    return { deliveryId: claim.id, status: "FAILURE" };
  }
}

export async function completeReportEffect(claim: ReportClaim, outcome: ReportProviderOutcome) {
  return prisma.$transaction(async tx => {
    const delivery = await lockReportClaim(tx, claim);
    if (delivery.effectState !== "IN_FLIGHT") throw new ReportExecutionError("REPORT_LEASE_STALE");
    const accepted = outcome.kind === "ACCEPTED" || outcome.kind === "SIMULATED";
    const retry = outcome.kind === "REJECTED" && outcome.grantClosed && outcome.retryable && delivery.attemptCount < 5;
    const backoff = [60, 300, 900, 3600][Math.min(delivery.attemptCount - 1, 3)] + Math.floor(Math.random() * 15);
    const seconds = outcome.kind === "REJECTED" ? Math.max(backoff, Math.min(outcome.retryAfterSeconds ?? 0, 3600)) : backoff;
    const result = await tx.reportDelivery.update({ where: { id: claim.id }, data: {
      status: accepted ? (outcome.kind === "SIMULATED" ? "SIMULATED" : "SENT") : retry ? "PROCESSING" : "FAILURE",
      effectState: accepted ? "ACCEPTED" : outcome.kind === "REJECTED" ? "REJECTED" : "UNKNOWN",
      errorCode: accepted ? null : outcome.kind === "REJECTED" && delivery.attemptCount >= 5 ? "WORKER_ATTEMPTS_EXHAUSTED" : "code" in outcome ? outcome.code : null,
      providerMessageId: accepted ? outcome.messageId : null, sentAt: accepted ? new Date() : null,
      nextAttemptAt: retry ? new Date(Date.now() + seconds * 1000) : null,
      reconciliationEvidence: outcome.kind === "REJECTED" ? { version: 1, source: "REPORT_ADAPTER", kind: "REJECTED", grantClosed: true, binding: reportIntentSchema.parse(delivery.intentJson).binding, hash: delivery.snapshotHash, code: outcome.code } : Prisma.DbNull,
      leaseToken: null, leaseExpiresAt: null, executionVersion: { increment: 1 },
    } });
    return { deliveryId: result.id, status: result.status };
  });
}

async function buildReportPayload({
  organizationId,
  organizationName,
  currency,
  reportType,
  stallIds,
  periodStart,
  periodEnd,
}: {
  organizationId: string;
  organizationName: string;
  currency: string;
  reportType: ReportScheduleType;
  stallIds: string[];
  periodStart: string;
  periodEnd: string;
}): Promise<ReportPayload> {
  const scopedIds = Prisma.join(stallIds.map((id) => Prisma.sql`${id}::uuid`));
  const [summaries, payments, variances] = await Promise.all([
    prisma.dailyStallSummary.findMany({
      where: {
        organizationId,
        stallId: { in: stallIds },
        businessDate: {
          gte: new Date(`${periodStart}T00:00:00.000Z`),
          lte: new Date(`${periodEnd}T00:00:00.000Z`),
        },
      },
      include: { stall: { select: { name: true } } },
      orderBy: [{ businessDate: "asc" }, { stallId: "asc" }],
    }),
    getPaymentMethodReport(organizationId, stallIds, periodStart, periodEnd),
    prisma.$queryRaw<CashVarianceRow[]>(Prisma.sql`
      select
        shift.stall_id,
        stall.name as stall_name,
        shift.closed_at,
        shift.system_expected_amount,
        shift.counted_amount,
        shift.variance_amount
      from public.cash_shifts shift
      join public.stalls stall on stall.id = shift.stall_id
      where shift.organization_id = ${organizationId}::uuid
        and shift.stall_id in (${scopedIds})
        and shift.status = 'CLOSED'::public.cash_shift_status
        and shift.variance_amount is not null
        and public.stall_business_date(stall.id, shift.closed_at) between ${periodStart}::date and ${periodEnd}::date
      order by shift.closed_at asc
    `),
  ]);
  const byStall = new Map<string, ReportPayload["stalls"][number]>();
  for (const summary of summaries) {
    const current = byStall.get(summary.stallId) ?? {
      stallName: summary.stall.name,
      orderCount: 0,
      completedOrderCount: 0,
      cancelledOrderCount: 0,
      netSales: 0,
    };
    current.orderCount += summary.orderCount;
    current.completedOrderCount += summary.completedOrderCount;
    current.cancelledOrderCount += summary.cancelledOrderCount;
    current.netSales += summary.netSales;
    byStall.set(summary.stallId, current);
  }
  const mappedVariances = variances.map((row) => ({
    stallName: row.stall_name,
    closedAt: row.closed_at.toISOString(),
    expectedAmount: Number(row.system_expected_amount),
    countedAmount: Number(row.counted_amount),
    varianceAmount: Number(row.variance_amount),
  }));
  return {
    organizationName,
    reportType,
    periodStart,
    periodEnd,
    currency,
    totals: {
      orderCount: summaries.reduce((sum, item) => sum + item.orderCount, 0),
      completedOrderCount: summaries.reduce((sum, item) => sum + item.completedOrderCount, 0),
      cancelledOrderCount: summaries.reduce((sum, item) => sum + item.cancelledOrderCount, 0),
      netSales: summaries.reduce((sum, item) => sum + item.netSales, 0),
      discountAmount: summaries.reduce((sum, item) => sum + item.discountAmount, 0),
      cashAmount: sumPaidAmountByMethod(payments, "CASH"),
      paymentVariance: mappedVariances.reduce((sum, item) => sum + item.varianceAmount, 0),
    },
    stalls: [...byStall.values()],
    payments: payments.map((payment) => ({
      stallName: payment.stallName,
      method: payment.method,
      methodLabel: payment.methodLabel,
      paymentCount: payment.paymentCount,
      amount: payment.amount,
    })),
    variances: mappedVariances,
  };
}

function renderReport(payload: ReportPayload) {
  const typeLabel = reportScheduleTypeLabels[payload.reportType];
  const lines = [
    payload.organizationName,
    `${typeLabel}（${payload.periodStart} 至 ${payload.periodEnd}）`,
    `訂單登記額：${formatMoney(payload.totals.netSales, payload.currency)}`,
    `訂單／完成／取消：${payload.totals.orderCount}／${payload.totals.completedOrderCount}／${payload.totals.cancelledOrderCount}`,
    `折扣：${formatMoney(payload.totals.discountAmount, payload.currency)}`,
    `實收現金（依收款日）：${formatMoney(payload.totals.cashAmount, payload.currency)}`,
    `現金短溢收：${formatMoney(payload.totals.paymentVariance, payload.currency)}`,
    "",
    ...payload.stalls.map((stall) => `${stall.stallName}：${formatMoney(stall.netSales, payload.currency)}，訂單 ${stall.orderCount}`),
    "",
    ...payload.variances.map((variance) => `${variance.stallName}：應有 ${formatMoney(variance.expectedAmount, payload.currency)}，盤點 ${formatMoney(variance.countedAmount, payload.currency)}，差異 ${formatMoney(variance.varianceAmount, payload.currency)}`),
  ];
  const tableRows = payload.stalls.map((stall) => `<tr><td>${escapeHtml(stall.stallName)}</td><td>${stall.orderCount}</td><td>${stall.completedOrderCount}</td><td>${escapeHtml(formatMoney(stall.netSales, payload.currency))}</td></tr>`).join("");
  const varianceRows = payload.variances.map((variance) => `<tr><td>${escapeHtml(variance.stallName)}</td><td>${escapeHtml(formatMoney(variance.expectedAmount, payload.currency))}</td><td>${escapeHtml(formatMoney(variance.countedAmount, payload.currency))}</td><td>${escapeHtml(formatMoney(variance.varianceAmount, payload.currency))}</td></tr>`).join("");
  const html = `<!doctype html><html lang="zh-Hant-TW"><body style="margin:0;background:#fafaf9;color:#1c1917;font-family:Arial,sans-serif"><main style="max-width:720px;margin:0 auto;padding:28px 20px"><p style="margin:0;color:#0f766e;font-weight:700">StallOrder</p><h1 style="font-size:24px;margin:8px 0 4px">${escapeHtml(typeLabel)}</h1><p style="margin:0 0 24px;color:#57534e">${escapeHtml(payload.organizationName)} · ${payload.periodStart} 至 ${payload.periodEnd}</p><table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr><td style="padding:12px;border-bottom:1px solid #e7e5e4">訂單登記額</td><td style="padding:12px;border-bottom:1px solid #e7e5e4;font-weight:700">${escapeHtml(formatMoney(payload.totals.netSales, payload.currency))}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #e7e5e4">實收現金（依收款日）</td><td style="padding:12px;border-bottom:1px solid #e7e5e4;font-weight:700">${escapeHtml(formatMoney(payload.totals.cashAmount, payload.currency))}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #e7e5e4">訂單／完成／取消</td><td style="padding:12px;border-bottom:1px solid #e7e5e4">${payload.totals.orderCount}／${payload.totals.completedOrderCount}／${payload.totals.cancelledOrderCount}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #e7e5e4">現金短溢收</td><td style="padding:12px;border-bottom:1px solid #e7e5e4">${escapeHtml(formatMoney(payload.totals.paymentVariance, payload.currency))}</td></tr></table><h2 style="font-size:18px">攤位摘要</h2><table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">攤位</th><th align="left">訂單</th><th align="left">完成</th><th align="left">訂單登記額</th></tr></thead><tbody>${tableRows || '<tr><td colspan="4" style="padding:16px 0;color:#78716c">此期間沒有銷售資料。</td></tr>'}</tbody></table>${payload.variances.length ? `<h2 style="font-size:18px;margin-top:28px">付款差異</h2><table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">攤位</th><th align="left">應有</th><th align="left">盤點</th><th align="left">差異</th></tr></thead><tbody>${varianceRows}</tbody></table>` : ""}<p style="margin-top:32px;color:#78716c;font-size:12px">此信由 StallOrder 排程寄送，請勿直接回覆。</p></main></body></html>`;
  return { html, text: lines.join("\n") };
}

function scheduleTime(schedule: ReportSchedule) {
  return {
    reportType: schedule.reportType,
    timezone: schedule.timezone,
    sendHour: schedule.sendHour,
    sendMinute: schedule.sendMinute,
    dayOfWeek: schedule.dayOfWeek,
  };
}

function reportSubject(organizationName: string, reportType: ReportScheduleType, periodStart: string, periodEnd: string) {
  return `${organizationName}｜${reportScheduleTypeLabels[reportType]}｜${periodStart}${periodStart === periodEnd ? "" : ` - ${periodEnd}`}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
