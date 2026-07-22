import "server-only";

import type { NotificationJob } from "@prisma/client";
import {
  lineIntegrationSecretsSchema,
  lineRecipientSecretSchema,
  type LineNotificationTemplateCode,
} from "@/lib/line-notification-contract";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/server/billing/entitlement-service";
import { lineTemplateEnabled } from "./line-integration-service";
import { LineMessagingProvider } from "./line-messaging-provider";
import { NotificationProviderError } from "./notification-provider";
import { readNotificationSecret } from "./notification-secrets";

const MAX_ATTEMPTS = 5;

export async function processDueNotificationJobs(now = new Date(), limit = 20) {
  await prisma.notificationJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    data: {
      status: "FAILED",
      nextAttemptAt: now,
      lastErrorCode: "WORKER_LEASE_EXPIRED",
    },
  });
  const candidates = await prisma.notificationJob.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, status: true },
  });
  const claimed: string[] = [];
  for (const candidate of candidates) {
    const result = await prisma.notificationJob.updateMany({
      where: { id: candidate.id, status: candidate.status, attemptCount: { lt: MAX_ATTEMPTS } },
      data: { status: "PROCESSING", attemptCount: { increment: 1 }, nextAttemptAt: null },
    });
    if (result.count === 1) claimed.push(candidate.id);
  }
  return Promise.all(claimed.map((jobId) => processClaimedNotificationJob(jobId, now)));
}

async function processClaimedNotificationJob(jobId: string, now: Date) {
  const job = await prisma.notificationJob.findUnique({
    where: { id: jobId },
    include: {
      integration: true,
      contactLink: true,
      order: { include: { stall: { select: { name: true } } } },
    },
  });
  if (!job || job.status !== "PROCESSING") return { jobId, status: "SKIPPED" };
  if (
    !job.order
    || job.integration.status !== "ACTIVE"
    || job.contactLink.consentStatus !== "GRANTED"
    || !lineTemplateEnabled(job.integration.settingsJson, job.templateCode as LineNotificationTemplateCode)
  ) {
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: { status: "CANCELLED", lastErrorCode: "DELIVERY_NOT_ALLOWED" },
    });
    return { jobId, status: "CANCELLED" };
  }

  try {
    await entitlementService.assertFeatureEnabled(job.organizationId, "LINE_NOTIFICATIONS");
    const [integrationSecretValue, recipientSecretValue] = await Promise.all([
      readNotificationSecret(job.integration.secretReference ?? ""),
      readNotificationSecret(job.recipientReference),
    ]);
    const integrationSecret = lineIntegrationSecretsSchema.parse(JSON.parse(integrationSecretValue));
    const recipientSecret = lineRecipientSecretSchema.parse(JSON.parse(recipientSecretValue));
    const provider = new LineMessagingProvider(integrationSecret.channelAccessToken);
    const result = await provider.send({
      jobId: job.id,
      recipient: recipientSecret.providerUserId,
      text: renderLineNotification({
        templateCode: job.templateCode as LineNotificationTemplateCode,
        stallName: job.order.stall.name,
        orderNo: job.order.orderNo,
        fulfillmentType: job.order.fulfillmentType,
        pickupCode: job.order.pickupCodeDisplay,
        quotedWaitMinutes: job.order.quotedWaitMinutes,
        total: job.order.total,
        trackingToken: recipientSecret.trackingToken,
        appUrl: requiredAppUrl(),
      }),
    });
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "SENT",
        sentAt: now,
        providerMessageId: result.providerMessageId,
        lastErrorCode: null,
      },
    });
    logEvent("info", "LINE_NOTIFICATION_SENT", {
      jobId: job.id,
      organizationId: job.organizationId,
      stallId: job.stallId,
      templateCode: job.templateCode,
    });
    return { jobId, status: "SENT" };
  } catch (error) {
    const failure = notificationFailure(error, job, now);
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        nextAttemptAt: failure.nextAttemptAt,
        lastErrorCode: failure.code,
      },
    });
    if (!failure.nextAttemptAt) await createNotificationFailureAlert(job, failure.code, now);
    logEvent("error", "LINE_NOTIFICATION_FAILED", {
      jobId: job.id,
      organizationId: job.organizationId,
      stallId: job.stallId,
      errorCode: failure.code,
      retryable: Boolean(failure.nextAttemptAt),
    });
    return { jobId, status: "FAILED", retryAt: failure.nextAttemptAt?.toISOString() ?? null };
  }
}

export function notificationRetry(attemptCount: number, retryable: boolean, now = new Date()) {
  if (!retryable || attemptCount >= MAX_ATTEMPTS) return null;
  const delayMinutes = Math.min(30, 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

function notificationFailure(error: unknown, job: NotificationJob, now: Date) {
  if (error instanceof NotificationProviderError) {
    return { code: error.code, nextAttemptAt: notificationRetry(job.attemptCount, error.retryable, now) };
  }
  if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")) {
    return {
      code: "LINE_NETWORK_ERROR",
      nextAttemptAt: notificationRetry(job.attemptCount, true, now),
    };
  }
  const detail = error instanceof Error ? error.message : "UNKNOWN";
  const code = detail.startsWith("NOTIFICATION_SECRET_")
    ? detail.slice(0, 80)
    : "NOTIFICATION_PROCESSING_FAILED";
  return { code, nextAttemptAt: notificationRetry(job.attemptCount, false, now) };
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
  return `${input.stallName}：訂單 ${input.orderNo} 已取消，請洽現場工作人員。\n查看訂單：${orderUrl}`;
}

function requiredAppUrl() {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!value || new URL(value).protocol !== "https:") throw new Error("NOTIFICATION_APP_URL_INVALID");
  return value;
}
