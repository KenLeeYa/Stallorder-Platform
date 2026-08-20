import "server-only";

import { Prisma } from "@prisma/client";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { FutureEmailProvider } from "@/server/notifications/future-email-provider";
import { InAppNotificationProvider } from "@/server/notifications/in-app-notification-provider";
import {
  NotificationProviderError,
  type NotificationProviderAdapter,
} from "@/server/notifications/notification-provider";

const DEFAULT_MAX_BATCH = 20;
const MAX_BATCH = 50;
const LEASE_SECONDS = 10 * 60;
const PENDING_DEPTH_ALERT_THRESHOLD = 100;
const PENDING_AGE_ALERT_THRESHOLD_SECONDS = 10 * 60;

export type ClaimedNotificationOutbox = {
  id: string;
  organizationId: string;
  billingNotificationId: string;
  channel: "IN_APP" | "EMAIL";
  attemptCount: number;
  maxAttempts: number;
  deliveryKey: string;
};

export type OutboxHealthSnapshot = {
  pendingDepth: number;
  oldestPendingAgeSeconds: number | null;
  deadLetterDepth: number;
};

type OutboxOutcomeStatus = "DELIVERED" | "RETRY_PENDING" | "DEAD_LETTER" | "SKIPPED";
type OutboxOutcome = {
  outboxId: string;
  status: OutboxOutcomeStatus;
  retryAt?: string | null;
};

type DispatchDependencies = {
  deliver: (entry: ClaimedNotificationOutbox) => Promise<void>;
  complete: (input: {
    outboxId: string;
    workerId: string;
    now: Date;
  }) => Promise<boolean>;
  fail: (input: {
    outboxId: string;
    workerId: string;
    errorCode: string;
    retryAt: Date | null;
    now: Date;
  }) => Promise<Exclude<OutboxOutcomeStatus, "DELIVERED"> | "DELIVERED">;
};

export class OutboxDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "OutboxDeliveryError";
  }
}

export function outboxRetryAt(
  attemptCount: number,
  maxAttempts: number,
  retryable: boolean,
  now = new Date(),
) {
  if (!retryable || attemptCount >= maxAttempts) return null;
  const delaysMinutes = [1, 5, 15, 60, 360] as const;
  const delay = delaysMinutes[Math.min(Math.max(attemptCount - 1, 0), delaysMinutes.length - 1)];
  return new Date(now.getTime() + delay * 60_000);
}

export function classifyOutboxHealth(snapshot: OutboxHealthSnapshot) {
  const alerts: string[] = [];
  if (snapshot.pendingDepth > PENDING_DEPTH_ALERT_THRESHOLD) {
    alerts.push("NOTIFICATION_OUTBOX_PENDING_DEPTH_HIGH");
  }
  if (
    snapshot.oldestPendingAgeSeconds !== null
    && snapshot.oldestPendingAgeSeconds > PENDING_AGE_ALERT_THRESHOLD_SECONDS
  ) {
    alerts.push("NOTIFICATION_OUTBOX_PENDING_AGE_HIGH");
  }
  if (snapshot.deadLetterDepth > 0) {
    alerts.push("NOTIFICATION_OUTBOX_DEAD_LETTER_PRESENT");
  }
  return alerts;
}

export async function dispatchClaimedNotificationOutbox(
  entry: ClaimedNotificationOutbox,
  workerId: string,
  now = new Date(),
  dependencies: DispatchDependencies = defaultDispatchDependencies,
): Promise<OutboxOutcome> {
  try {
    await dependencies.deliver(entry);
  } catch (error) {
    const failure = outboxFailure(error);
    const retryAt = outboxRetryAt(
      entry.attemptCount,
      entry.maxAttempts,
      failure.retryable,
      now,
    );
    const status = await dependencies.fail({
      outboxId: entry.id,
      workerId,
      errorCode: failure.code,
      retryAt,
      now,
    });
    logEvent(status === "DEAD_LETTER" ? "error" : "warn", "NOTIFICATION_OUTBOX_DELIVERY_FAILED", {
      outboxId: entry.id,
      channel: entry.channel,
      attemptCount: entry.attemptCount,
      errorCode: failure.code,
      retryable: status === "RETRY_PENDING",
    });
    return { outboxId: entry.id, status, retryAt: retryAt?.toISOString() ?? null };
  }

  // Completion is deliberately outside the provider error handler. If the process
  // stops after delivery, the lease is recovered and the same delivery key is reused.
  const completed = await dependencies.complete({ outboxId: entry.id, workerId, now });
  if (!completed) throw new Error("NOTIFICATION_OUTBOX_CLAIM_LOST");
  logEvent("info", "NOTIFICATION_OUTBOX_DELIVERED", {
    outboxId: entry.id,
    channel: entry.channel,
    attemptCount: entry.attemptCount,
  });
  return { outboxId: entry.id, status: "DELIVERED" };
}

export async function processOutboxDispatchCycle(
  workerId: string,
  now = new Date(),
  limit = DEFAULT_MAX_BATCH,
) {
  const domainQuarantined = await quarantineDormantDomainOutbox(now);
  const claimed = await claimNotificationOutbox(workerId, now, limit);
  const outcomes = await Promise.all(
    claimed.map((entry) => dispatchClaimedNotificationOutbox(entry, workerId, now)),
  );
  const health = await readNotificationOutboxHealth(now);
  const alerts = classifyOutboxHealth(health);
  if (domainQuarantined > 0) alerts.push("DOMAIN_OUTBOX_DORMANT_EVENT_QUARANTINED");
  for (const alert of alerts) {
    logEvent(alert === "NOTIFICATION_OUTBOX_DEAD_LETTER_PRESENT" ? "error" : "warn", alert, {
      pendingDepth: health.pendingDepth,
      oldestPendingAgeSeconds: health.oldestPendingAgeSeconds,
      deadLetterDepth: health.deadLetterDepth,
      domainQuarantined,
    });
  }
  return { outcomes, domainQuarantined, health, alerts };
}

export async function deliverNotificationOutbox(entry: ClaimedNotificationOutbox) {
  const provider: NotificationProviderAdapter = entry.channel === "IN_APP"
    ? new InAppNotificationProvider()
    : new FutureEmailProvider();
  await provider.send({
    jobId: entry.deliveryKey,
    recipient: "LOCAL_BILLING_NOTIFICATION",
    text: "BILLING_NOTIFICATION_PERSISTED",
  });
}

function outboxFailure(error: unknown) {
  if (error instanceof OutboxDeliveryError || error instanceof NotificationProviderError) {
    return { code: safeErrorCode(error.code), retryable: error.retryable };
  }
  if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")) {
    return { code: "OUTBOX_PROVIDER_TIMEOUT", retryable: true };
  }
  return { code: "OUTBOX_DELIVERY_FAILED", retryable: false };
}

function safeErrorCode(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120);
  return normalized || "OUTBOX_DELIVERY_FAILED";
}

async function claimNotificationOutbox(
  workerId: string,
  now: Date,
  limit: number,
) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_BATCH);
  return prisma.$queryRaw<ClaimedNotificationOutbox[]>(Prisma.sql`
    select
      claimed.id::text as "id",
      claimed.organization_id::text as "organizationId",
      claimed.billing_notification_id::text as "billingNotificationId",
      claimed.channel as "channel",
      claimed.attempt_count as "attemptCount",
      claimed.max_attempts as "maxAttempts",
      'notification-outbox:' || claimed.id::text as "deliveryKey"
    from app_private.claim_notification_outbox(
      ${workerId}::text,
      ${boundedLimit}::integer,
      ${now}::timestamptz,
      ${LEASE_SECONDS}::integer
    ) claimed
  `);
}

async function completeNotificationOutbox(input: {
  outboxId: string;
  workerId: string;
  now: Date;
}) {
  const [result] = await prisma.$queryRaw<Array<{ completed: boolean }>>(Prisma.sql`
    select app_private.complete_notification_outbox(
      ${input.outboxId}::uuid,
      ${input.workerId}::text,
      ${input.now}::timestamptz
    ) as completed
  `);
  return result?.completed === true;
}

async function failNotificationOutbox(input: {
  outboxId: string;
  workerId: string;
  errorCode: string;
  retryAt: Date | null;
  now: Date;
}) {
  const [result] = await prisma.$queryRaw<Array<{ status: OutboxOutcomeStatus }>>(Prisma.sql`
    select app_private.fail_notification_outbox(
      ${input.outboxId}::uuid,
      ${input.workerId}::text,
      ${input.errorCode}::text,
      ${input.retryAt}::timestamptz,
      ${input.now}::timestamptz
    ) as status
  `);
  return result?.status ?? "SKIPPED";
}

async function quarantineDormantDomainOutbox(now: Date) {
  const [result] = await prisma.$queryRaw<Array<{ quarantined: number }>>(Prisma.sql`
    select app_private.quarantine_dormant_domain_outbox(${now}::timestamptz)::integer
      as quarantined
  `);
  return result?.quarantined ?? 0;
}

async function readNotificationOutboxHealth(now: Date): Promise<OutboxHealthSnapshot> {
  const [result] = await prisma.$queryRaw<Array<OutboxHealthSnapshot>>(Prisma.sql`
    select
      health.pending_depth as "pendingDepth",
      health.oldest_pending_age_seconds as "oldestPendingAgeSeconds",
      health.dead_letter_depth as "deadLetterDepth"
    from app_private.notification_outbox_health(${now}::timestamptz) health
  `);
  return result ?? { pendingDepth: 0, oldestPendingAgeSeconds: null, deadLetterDepth: 0 };
}

const defaultDispatchDependencies: DispatchDependencies = {
  deliver: deliverNotificationOutbox,
  complete: completeNotificationOutbox,
  fail: failNotificationOutbox,
};
