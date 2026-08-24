import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { billingPeriodEndInstant } from "@/server/billing/billing-period";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";
import { PaygBillingError, paygBillingService } from "@/server/billing/payg-billing-service";

const MAX_BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

export async function processAutomaticPaygClose(now = new Date()) {
  const state = await getBillingExperienceState();
  if (!state.paygAutomaticInvoiceCloseEnabled) return emptyResult("DISABLED");
  if (state.openBetaFreeAccess || !state.paygBillingEnabled || !state.paygRefundCreditsEnabled) {
    return emptyResult("PREREQUISITES_BLOCKED");
  }

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      pricingEffectiveAt: { not: null },
      invoiceCloseDelayHours: { not: null },
      plan: { code: "PAYG", isActive: true },
      planVersion: {
        sealedAt: { not: null },
        contractHash: { not: null },
        taxTreatment: { not: "UNCONFIGURED" },
      },
    },
    include: { plan: true, planVersion: { include: { entitlements: true } } },
    orderBy: [{ billingPeriodEnd: "asc" }, { id: "asc" }],
    take: MAX_BATCH_SIZE,
  });

  const result = { status: "COMPLETED", eligible: 0, succeeded: 0, skipped: 0, failed: 0 };
  for (const subscription of subscriptions) {
    const delayHours = subscription.invoiceCloseDelayHours;
    if (delayHours === null) {
      result.skipped += 1;
      continue;
    }
    const closeAfter = billingPeriodEndInstant(subscription.billingPeriodStart, subscription).getTime()
      + delayHours * 60 * 60_000;
    if (closeAfter > now.getTime()) {
      result.skipped += 1;
      continue;
    }
    result.eligible += 1;
    const period = subscription.billingPeriodStart;
    const periodKey = period.toISOString().slice(0, 10);
    const idempotencyKey = `PAYG_CLOSE:${subscription.id}:${periodKey}`;
    const job = await prisma.paygCloseJob.upsert({
      where: { idempotencyKey },
      create: { subscriptionId: subscription.id, billingPeriod: period, idempotencyKey },
      update: {},
    });
    if (job.status === "SUCCEEDED" || job.status === "RUNNING" || job.attemptCount >= MAX_ATTEMPTS) {
      result.skipped += 1;
      continue;
    }

    const requestId = `payg-auto-${randomUUID()}`;
    const claimed = await prisma.paygCloseJob.updateMany({
      where: {
        id: job.id,
        status: { in: ["PENDING", "FAILED"] },
        attemptCount: { lt: MAX_ATTEMPTS },
      },
      data: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        lastErrorCode: null,
        lastRequestId: requestId,
        startedAt: now,
        completedAt: null,
      },
    });
    if (claimed.count !== 1) {
      result.skipped += 1;
      continue;
    }
    try {
      await paygBillingService.closeBillingPeriod(
        subscription.id,
        { billingPeriod: period, reason: "Automatic PAYG calendar-month close" },
        { actorProfileId: null, requestId },
      );
      await prisma.paygCloseJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", completedAt: new Date(), lastErrorCode: null },
      });
      result.succeeded += 1;
    } catch (error) {
      const errorCode = error instanceof PaygBillingError ? error.code : "PAYG_CLOSE_UNEXPECTED";
      await prisma.paygCloseJob.update({
        where: { id: job.id },
        data: { status: "FAILED", completedAt: new Date(), lastErrorCode: errorCode },
      });
      result.failed += 1;
    }
  }
  return result;
}

function emptyResult(status: "DISABLED" | "PREREQUISITES_BLOCKED") {
  return { status, eligible: 0, succeeded: 0, skipped: 0, failed: 0 };
}
