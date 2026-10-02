import "server-only";
import type { NotificationJob } from "@prisma/client";
import type { LineNotificationTemplateCode } from "@/lib/line-notification-contract";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { LineMessagingProvider } from "./line-messaging-provider";
import { NotificationProviderError } from "./notification-provider";
import {
  authorizeLegacyEffect, claimLegacyNotificationJobs, completeLegacyNotification,
  legacyClaimAttempt, prepareLegacyNotification, recoverLegacyNotificationJobs,
  type LegacyNotificationClaim,
} from "./legacy-notification-execution";

const MAX_ATTEMPTS = 5;

export async function processDueNotificationJobs(_now = new Date(), limit = 20) {
  void _now; // Keep the caller signature; lease authority uses the database clock.
  await recoverLegacyNotificationJobs();
  const claims = await claimLegacyNotificationJobs(Math.min(Math.max(limit, 1), 50));
  return Promise.all(claims.map(processClaimedNotificationJob));
}

async function processClaimedNotificationJob(claim: LegacyNotificationClaim) {
  const prepared = await prepareLegacyNotification(claim, renderLineNotification);
  if ("status" in prepared) return prepared;
  const approved = await authorizeLegacyEffect(claim, prepared.hash);
  if ("status" in approved) return approved;
  // No row locks survive the committed grant. The transport is explicitly local Mock only.
  let completion: Parameters<typeof completeLegacyNotification>[1];
  try {
    const result = await new LineMessagingProvider(approved.token, approved.transport).send(prepared.message);
    completion = { outcome: "SIMULATED", providerMessageId: result.providerMessageId };
  } catch (error) {
    if (error instanceof NotificationProviderError && error.acceptance === "REJECTED") {
      const retryAt = notificationRetry(await legacyClaimAttempt(claim), error.retryable);
      completion = { outcome: retryAt ? "RETRY_SCHEDULED" : "FAILED", code: error.code, retryAt };
    } else {
      completion = { outcome: "MANUAL_REVIEW", code: "LEGACY_DELIVERY_OUTCOME_UNKNOWN" };
    }
  }
  // A lost completion is also unknown; recovery must not grant another effect.
  let completed = false;
  try { completed = await completeLegacyNotification(claim, completion); } catch { /* Durable IN_FLIGHT is reconciled by recovery. */ }
  if (!completed) return { jobId: claim.id, status: "UNKNOWN", reason: "LEGACY_COMPLETION_UNCONFIRMED" };
  if (completion.outcome === "FAILED" || completion.outcome === "MANUAL_REVIEW") {
    const job = await prisma.notificationJob.findUniqueOrThrow({ where: { id: claim.id } });
    await createNotificationFailureAlert(job, completion.code!, new Date());
  }
  logEvent(completion.outcome === "SIMULATED" ? "info" : "error", "LEGACY_NOTIFICATION_RESULT", {
    jobId: claim.id, outcome: completion.outcome, errorCode: completion.code ?? null,
  });
  return { jobId: claim.id, status: completion.outcome === "MANUAL_REVIEW" ? "UNKNOWN" : completion.outcome,
    retryAt: completion.retryAt?.toISOString() ?? null };
}

export function notificationRetry(attemptCount: number, retryable: boolean, now = new Date()) {
  if (!retryable || attemptCount >= MAX_ATTEMPTS) return null;
  const delayMinutes = Math.min(30, 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

async function createNotificationFailureAlert(job: NotificationJob, code: string, now: Date) {
  const existing = await prisma.operationalAlert.findFirst({
    where: {
      organizationId: job.organizationId,
      stallId: job.stallId,
      alertType: "LINE_NOTIFICATION_FAILURE",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.operationalAlert.create({
    data: {
      organizationId: job.organizationId,
      stallId: job.stallId,
      alertType: "LINE_NOTIFICATION_FAILURE",
      severity: "WARNING",
      message: `LINE 通知傳送失敗（${code}），請檢查整合設定。`,
      detectedAt: now,
    },
  });
}

export function renderLineNotification(input: {
  templateCode: LineNotificationTemplateCode;
  stallName: string;
  orderNo: string;
  fulfillmentType: string;
  pickupCode: string | null;
  quotedWaitMinutes: number | null;
  total: number;
  pendingFulfillmentAt?: Date | null;
  fulfillmentTimeChangeReason?: string | null;
  timezone?: string;
  trackingToken: string;
  appUrl: string;
}) {
  const orderUrl = `${input.appUrl}/order/${encodeURIComponent(input.trackingToken)}`;
  const reorderUrl = `${orderUrl}/reorder`;
  if (input.templateCode === "ORDER_CONFIRMED") {
    const wait = input.quotedWaitMinutes ? `，預估等候 ${input.quotedWaitMinutes} 分鐘` : "";
    return `${input.stallName}：訂單 ${input.orderNo} 已確認${wait}。\n查看訂單：${orderUrl}`;
  }
  if (input.templateCode === "ORDER_READY") {
    const pickup = input.fulfillmentType === "TAKEOUT" && input.pickupCode
      ? `，請憑取餐碼 ${input.pickupCode} 取餐`
      : "";
    return `${input.stallName}：訂單 ${input.orderNo} 已完成${pickup}。\n本次金額 NT$${input.total}\n再次點餐：${reorderUrl}`;
  }
  if (input.templateCode === "FULFILLMENT_TIME_PROPOSED") {
    const label = input.fulfillmentType === "DELIVERY" ? "送達" : "取餐";
    const proposedTime = input.pendingFulfillmentAt
      ? new Intl.DateTimeFormat("zh-TW", {
          timeZone: input.timezone ?? "Asia/Taipei",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(input.pendingFulfillmentAt)
      : "新的建議時間";
    const reason = input.fulfillmentTimeChangeReason
      ? `（${input.fulfillmentTimeChangeReason}）`
      : "";
    return `${input.stallName}：訂單 ${input.orderNo} 建議將${label}時間改為 ${proposedTime}${reason}，請確認是否接受。\n前往確認：${orderUrl}`;
  }
  return `${input.stallName}：訂單 ${input.orderNo} 已取消，請洽現場工作人員。\n查看訂單：${orderUrl}`;
}
