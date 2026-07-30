import "server-only";

import { Prisma, type DeliverySyncJob } from "@prisma/client";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/server/billing/entitlement-service";
import { importExternalOrderFromJob } from "./external-order-service";
import { assertDeliveryProviderEnabled } from "./delivery-feature-flags";
import { getDeliveryPlatformAdapter } from "./delivery-platform-registry";
import {
  DeliveryPlatformError,
  safeDeliveryErrorCode,
} from "./delivery-platform-errors";
import type {
  DeliveryCircuitSource,
  DeliveryProvider,
} from "./delivery-platform-types";
import { parseDeliveryOrderJobInput } from "./delivery-order-contract";
import { assertDeliveryWriter } from "./writer-guard";

export const deliveryJobTypes = [
  "CONNECTION_HEALTH_CHECK",
  "STORE_DISCOVERY",
  "STORE_ACTIVATION",
  "MENU_FULL_SYNC",
  "MENU_INCREMENTAL_SYNC",
  "AVAILABILITY_SYNC",
  "ORDER_IMPORT",
  "ORDER_ACCEPT",
  "ORDER_REJECT",
  "ORDER_PREPARING",
  "ORDER_READY",
  "ORDER_RECONCILIATION",
  "CONNECTION_DISCONNECT",
] as const;

export type DeliveryJobType = (typeof deliveryJobTypes)[number];
type DeliveryJobDatabase = Prisma.TransactionClient;

export async function enqueueDeliverySyncJob(input: {
  organizationId: string;
  stallId: string;
  connectionId: string;
  provider: DeliveryProvider;
  jobType: DeliveryJobType;
  deduplicationKey: string;
  requestedViaCircuit: DeliveryCircuitSource;
  inputJson: Prisma.InputJsonValue;
  priority?: number;
  maxAttempts?: number;
}, database: DeliveryJobDatabase = prisma as unknown as DeliveryJobDatabase) {
  await assertDeliveryWriter(database);
  try {
    return await database.deliverySyncJob.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        connectionId: input.connectionId,
        provider: input.provider,
        jobType: input.jobType,
        deduplicationKey: input.deduplicationKey,
        requestedViaCircuit: input.requestedViaCircuit,
        inputJson: input.inputJson,
        priority: input.priority ?? 100,
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const existing = await database.deliverySyncJob.findUnique({
      where: {
        provider_deduplicationKey: {
          provider: input.provider,
          deduplicationKey: input.deduplicationKey,
        },
      },
    });
    if (!existing) throw error;
    return existing;
  }
}

export async function processDueDeliverySyncJobs(
  workerId: string,
  now = new Date(),
  limit = 20,
) {
  const jobs = await claimDeliverySyncJobs(workerId, now, limit);
  return Promise.all(jobs.map((job) => processClaimedDeliverySyncJob(job, now)));
}

export async function retryDeliverySyncJob(input: {
  jobId: string;
  actorProfileId: string;
  requestId: string;
  ipHash: string;
}) {
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    await transaction.$queryRaw`
      select id
      from public.delivery_sync_jobs
      where id = ${input.jobId}::uuid
      for update
    `;
    const job = await transaction.deliverySyncJob.findUnique({
      where: { id: input.jobId },
    });
    if (!job) {
      throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
    }
    if (!["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.status)) {
      throw new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
    }
    const updated = await transaction.deliverySyncJob.update({
      where: { id: job.id },
      data: {
        status: "RETRY_PENDING",
        attemptCount: 0,
        nextAttemptAt: new Date(),
        completedAt: null,
        claimedByWorker: null,
        lastErrorCode: null,
        lastErrorMessageSafe: null,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: job.organizationId,
        stallId: job.stallId,
        actorProfileId: input.actorProfileId,
        action: "DELIVERY_JOB_MANUAL_RETRY_APPROVED",
        entityType: "DELIVERY_SYNC_JOB",
        entityId: job.id,
        outcome: "SUCCESS",
        requestId: input.requestId,
        ipHash: input.ipHash,
        beforeJson: { status: job.status, attemptCount: job.attemptCount },
        afterJson: { status: updated.status, attemptCount: updated.attemptCount },
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function claimDeliverySyncJobs(
  workerId: string,
  now = new Date(),
  limit = 20,
) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    await transaction.$executeRaw`
      update public.delivery_sync_jobs
      set
        status = case
          when attempt_count >= max_attempts then 'DEAD_LETTER'
          else 'RETRY_PENDING'
        end,
        next_attempt_at = case
          when attempt_count >= max_attempts then null
          else ${now}
        end,
        last_error_code = 'WORKER_LEASE_EXPIRED',
        claimed_by_worker = null,
        updated_at = ${now}
      where status = 'PROCESSING'
        and updated_at < ${new Date(now.getTime() - 10 * 60_000)}
    `;
    const claimed = await transaction.$queryRaw<Array<{ id: string }>>`
      with candidates as (
        select id
        from public.delivery_sync_jobs
        where attempt_count < max_attempts
          and (
            (status = 'PENDING' and scheduled_at <= ${now})
            or (status = 'RETRY_PENDING' and next_attempt_at <= ${now})
          )
        order by priority asc, scheduled_at asc, created_at asc
        for update skip locked
        limit ${boundedLimit}
      )
      update public.delivery_sync_jobs jobs
      set
        status = 'PROCESSING',
        claimed_by_worker = ${workerId},
        attempt_count = jobs.attempt_count + 1,
        started_at = ${now},
        next_attempt_at = null,
        updated_at = ${now}
      from candidates
      where jobs.id = candidates.id
      returning jobs.id
    `;
    if (claimed.length === 0) return [];
    return transaction.deliverySyncJob.findMany({
      where: { id: { in: claimed.map((job) => job.id) } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
  });
}

export function deliveryRetryAt(
  attemptCount: number,
  retryable: boolean,
  now = new Date(),
) {
  if (!retryable) return null;
  const delaysMinutes = [1, 5, 15, 60, 360] as const;
  const delay = delaysMinutes[Math.min(Math.max(attemptCount - 1, 0), delaysMinutes.length - 1)];
  return new Date(now.getTime() + delay * 60_000);
}

async function processClaimedDeliverySyncJob(job: DeliverySyncJob, now: Date) {
  if (job.status !== "PROCESSING") return { jobId: job.id, status: "SKIPPED" };
  try {
    const provider = job.provider as DeliveryProvider;
    const featureState = await assertDeliveryProviderEnabled(provider, {
      organizationId: job.organizationId,
      stallId: job.stallId,
    });
    await assertJobFeatureAccess(job, featureState);
    const connection = await prisma.deliveryPlatformConnection.findFirst({
      where: {
        id: job.connectionId,
        organizationId: job.organizationId,
        stallId: job.stallId,
        provider,
      },
    });
    if (!connection) {
      throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
    }
    if (connection.status !== "ACTIVE") {
      throw new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
    }

    const result = job.jobType === "ORDER_IMPORT"
      ? await importExternalOrderFromJob(parseDeliveryOrderJobInput(job.inputJson), {
          jobId: job.id,
          circuit: job.requestedViaCircuit as DeliveryCircuitSource,
        })
      : await executeProviderJob(job, provider, connection);

    await prisma.$transaction(async (transaction) => {
      await assertDeliveryWriter(transaction);
      await transaction.deliverySyncJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          completedAt: now,
          claimedByWorker: null,
          lastErrorCode: null,
          lastErrorMessageSafe: null,
          resultJson: result as Prisma.InputJsonValue,
        },
      });
      await transaction.deliveryPlatformConnection.update({
        where: { id: connection.id },
        data: {
          lastSuccessfulSyncAt: now,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      });
    });
    logEvent("info", "DELIVERY_JOB_SUCCEEDED", {
      jobId: job.id,
      provider,
      jobType: job.jobType,
      circuit: job.requestedViaCircuit,
    });
    return { jobId: job.id, status: "SUCCEEDED" };
  } catch (error) {
    return failDeliveryJob(job, error, now);
  }
}

async function assertJobFeatureAccess(
  job: DeliverySyncJob,
  state: Awaited<ReturnType<typeof assertDeliveryProviderEnabled>>,
) {
  if (job.jobType === "ORDER_IMPORT") {
    if (!state.importOrders || !state.webhook) {
      throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
    }
    await entitlementService.assertFeatureEnabled(job.organizationId, "DELIVERY_ORDER_IMPORT");
    return;
  }
  if (job.jobType.startsWith("MENU_") || job.jobType === "AVAILABILITY_SYNC") {
    if (!state.menuSync) {
      throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
    }
    await entitlementService.assertFeatureEnabled(job.organizationId, "DELIVERY_MENU_SYNC");
    return;
  }
  if (job.jobType.startsWith("ORDER_")) {
    if (!state.providerActions) {
      throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
    }
    await entitlementService.assertFeatureEnabled(job.organizationId, "DELIVERY_PLATFORM_INTEGRATIONS");
  }
}

async function executeProviderJob(
  job: DeliverySyncJob,
  provider: DeliveryProvider,
  connection: {
    id: string;
    organizationId: string;
    stallId: string;
    externalStoreId: string | null;
    credentialReference: string | null;
  },
) {
  const adapter = getDeliveryPlatformAdapter(provider);
  const context = { ...connection, provider };
  const input = parseProviderActionInput(job.inputJson);
  if (job.jobType === "ORDER_ACCEPT") {
    await adapter.acceptOrder({ connection: context, ...input });
  } else if (job.jobType === "ORDER_REJECT") {
    await adapter.rejectOrder({ connection: context, ...input });
  } else if (job.jobType === "ORDER_PREPARING") {
    await adapter.markOrderPreparing({ connection: context, ...input });
  } else if (job.jobType === "ORDER_READY") {
    await adapter.markOrderReady({ connection: context, ...input });
  } else {
    throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
  }
  return { providerAcknowledged: true, jobType: job.jobType };
}

function parseProviderActionInput(value: Prisma.JsonValue) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new DeliveryPlatformError("UNSUPPORTED_MAPPING", { retryable: false });
  }
  const externalOrderId = value.externalOrderId;
  const idempotencyKey = value.idempotencyKey;
  const reasonCode = value.reasonCode;
  if (
    typeof externalOrderId !== "string"
    || externalOrderId.length === 0
    || externalOrderId.length > 200
    || typeof idempotencyKey !== "string"
    || idempotencyKey.length < 8
    || idempotencyKey.length > 240
    || (reasonCode !== undefined && reasonCode !== null && typeof reasonCode !== "string")
  ) {
    throw new DeliveryPlatformError("UNSUPPORTED_MAPPING", { retryable: false });
  }
  return {
    externalOrderId,
    idempotencyKey,
    reasonCode: typeof reasonCode === "string" ? reasonCode.slice(0, 80) : undefined,
  };
}

async function failDeliveryJob(job: DeliverySyncJob, error: unknown, now: Date) {
  const errorCode = safeDeliveryErrorCode(error);
  const retryable = error instanceof DeliveryPlatformError ? error.retryable : true;
  const nextAttemptAt = job.attemptCount < job.maxAttempts
    ? deliveryRetryAt(job.attemptCount, retryable, now)
    : null;
  const finalStatus = nextAttemptAt ? "RETRY_PENDING" : "DEAD_LETTER";

  await prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    await transaction.deliverySyncJob.update({
      where: { id: job.id },
      data: {
        status: finalStatus,
        claimedByWorker: null,
        completedAt: finalStatus === "DEAD_LETTER" ? now : null,
        nextAttemptAt,
        lastErrorCode: errorCode,
        lastErrorMessageSafe: errorCode,
      },
    });
    await transaction.deliveryPlatformConnection.updateMany({
      where: { id: job.connectionId },
      data: { lastErrorCode: errorCode, lastErrorAt: now },
    });
    if (finalStatus === "DEAD_LETTER") {
      await createDeliveryAlert(transaction, job, "DELIVERY_JOB_DEAD_LETTER", errorCode, now);
    }
  });
  logEvent(finalStatus === "DEAD_LETTER" ? "error" : "warn", "DELIVERY_JOB_FAILED", {
    jobId: job.id,
    provider: job.provider,
    jobType: job.jobType,
    errorCode,
    ...safeDeliveryDiagnostic(error),
    retryable: Boolean(nextAttemptAt),
    circuit: job.requestedViaCircuit,
  });
  return {
    jobId: job.id,
    status: finalStatus,
    retryAt: nextAttemptAt?.toISOString() ?? null,
  };
}

function safeDeliveryDiagnostic(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return { errorType: "PRISMA_KNOWN", prismaCode: error.code };
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return { errorType: "PRISMA_VALIDATION" };
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return { errorType: "PRISMA_INITIALIZATION" };
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return {
      errorType: "PRISMA_UNKNOWN",
      errorCategory: classifyPrismaUnknownError(error.message),
      ...safeConstraintDiagnostic(error.message),
    };
  }
  if (error instanceof DeliveryPlatformError) {
    return { errorType: "DELIVERY_PLATFORM" };
  }
  return { errorType: error instanceof Error ? error.name.slice(0, 80) : "UNKNOWN" };
}

function classifyPrismaUnknownError(message: string) {
  const normalized = message.toLowerCase();
  const categories: Array<[string, string]> = [
    ["transaction already closed", "TRANSACTION_CLOSED"],
    ["current transaction is aborted", "TRANSACTION_ABORTED"],
    ["could not serialize", "SERIALIZATION_CONFLICT"],
    ["prepared statement", "PREPARED_STATEMENT"],
    ["invalid input syntax", "INVALID_INPUT"],
    ["violates foreign key", "FOREIGN_KEY"],
    ["violates check constraint", "CHECK_CONSTRAINT"],
    ["null value in column", "NOT_NULL"],
    ["column", "COLUMN_OR_SCHEMA"],
    ["relation", "RELATION_OR_SCHEMA"],
  ];
  return categories.find(([fragment]) => normalized.includes(fragment))?.[1]
    ?? "UNCLASSIFIED";
}

function safeConstraintDiagnostic(message: string) {
  const match = message.match(/\b([a-z][a-z0-9_]{2,79}_(?:check|fkey|key))\b/i)
    ?? message.match(/constraint\s+[`'"]?([a-z][a-z0-9_]{0,79})/i);
  return match ? { constraintName: match[1].toLowerCase() } : {};
}

async function createDeliveryAlert(
  transaction: Prisma.TransactionClient,
  job: DeliverySyncJob,
  alertType: string,
  errorCode: string,
  now: Date,
) {
  const existing = await transaction.operationalAlert.findFirst({
    where: {
      organizationId: job.organizationId,
      stallId: job.stallId,
      alertType,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (existing) return;
  await transaction.operationalAlert.create({
    data: {
      organizationId: job.organizationId,
      stallId: job.stallId,
      alertType,
      severity: "ERROR",
      message: `外送平台工作已停止重試，錯誤代碼：${errorCode}`,
      detectedAt: now,
    },
  });
}
