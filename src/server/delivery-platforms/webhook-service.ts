import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/server/billing/entitlement-service";
import { serializeNormalizedExternalOrder } from "./delivery-order-contract";
import { readBoundedText } from "./bounded-text-reader";
import { assertDeliveryProviderEnabled } from "./delivery-feature-flags";
import { getDeliveryPlatformAdapter } from "./delivery-platform-registry";
import {
  DeliveryPlatformError,
  safeDeliveryErrorCode,
} from "./delivery-platform-errors";
import type {
  DeliveryCircuitSource,
  DeliveryProvider,
  VerifiedDeliveryWebhook,
} from "./delivery-platform-types";
import { enqueueDeliverySyncJob } from "./sync-job-service";
import { assertDeliveryWriter } from "./writer-guard";

const MAX_WEBHOOK_BYTES = 128_000;

export type DeliveryWebhookResult = {
  accepted: boolean;
  duplicate: boolean;
  eventId: string | null;
  jobId: string | null;
};

export async function processDeliveryWebhook(input: {
  provider: DeliveryProvider;
  connectionId: string;
  request: Request;
  circuit: DeliveryCircuitSource;
}): Promise<DeliveryWebhookResult> {
  const contentType = input.request.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
  if (
    input.request.method !== "POST"
    || contentType !== "application/json"
  ) {
    throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
  }

  const connection = await prisma.deliveryPlatformConnection.findFirst({
    where: {
      id: input.connectionId,
      provider: input.provider,
    },
  });
  if (!connection) {
    throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
  }
  if (connection.status !== "ACTIVE") {
    throw new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
  }
  const state = await assertDeliveryProviderEnabled(input.provider, {
    organizationId: connection.organizationId,
    stallId: connection.stallId,
  });
  if (!state.webhook || !state.importOrders) {
    throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
  }
  await entitlementService.assertFeatureEnabled(
    connection.organizationId,
    "DELIVERY_ORDER_IMPORT",
  );

  let rawBody: string;
  try {
    rawBody = await readBoundedText(input.request, MAX_WEBHOOK_BYTES);
  } catch {
    throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
  }
  if (rawBody.length === 0) {
    throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
  }
  const payloadHash = sha256(rawBody);
  const verificationRequest = new Request(input.request.url, {
    method: "POST",
    headers: input.request.headers,
    body: rawBody,
  });
  const adapter = getDeliveryPlatformAdapter(input.provider);
  let verified: VerifiedDeliveryWebhook;
  try {
    verified = await adapter.verifyWebhook(verificationRequest, {
      id: connection.id,
      organizationId: connection.organizationId,
      stallId: connection.stallId,
      provider: input.provider,
      externalChainId: connection.externalChainId,
      externalStoreId: connection.externalStoreId,
      credentialReference: connection.credentialReference,
    });
  } catch (error) {
    await recordRejectedWebhook({
      provider: input.provider,
      connectionId: connection.id,
      organizationId: connection.organizationId,
      stallId: connection.stallId,
      circuit: input.circuit,
      payloadHash,
      signatureValid: false,
      errorCode: safeDeliveryErrorCode(error),
    });
    logEvent("warn", "DELIVERY_WEBHOOK_REJECTED", {
      provider: input.provider,
      connectionId: connection.id,
      errorCode: safeDeliveryErrorCode(error),
      circuit: input.circuit,
    });
    throw error;
  }
  if (verified.provider !== input.provider || verified.payloadHash !== payloadHash) {
    const error = new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
    await recordRejectedWebhook({
      provider: input.provider,
      connectionId: connection.id,
      organizationId: connection.organizationId,
      stallId: connection.stallId,
      circuit: input.circuit,
      payloadHash,
      signatureValid: false,
      errorCode: error.code,
    });
    logEvent("warn", "DELIVERY_WEBHOOK_REJECTED", {
      provider: input.provider,
      connectionId: connection.id,
      errorCode: error.code,
      circuit: input.circuit,
    });
    throw error;
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      await assertDeliveryWriter(transaction);
      const event = await transaction.deliveryWebhookEvent.create({
        data: {
          provider: input.provider,
          connectionId: connection.id,
          organizationId: connection.organizationId,
          stallId: connection.stallId,
          externalEventId: verified.externalEventId,
          eventType: verified.eventType,
          signatureValid: true,
          replayKey: verified.replayKey,
          payloadHash: verified.payloadHash,
          receivedViaCircuit: input.circuit,
          processingStatus: verified.order || verified.orderReference ? "VERIFIED" : "PROCESSED",
          processedAt: verified.order || verified.orderReference ? null : new Date(),
        },
      });
      if (!verified.order && !verified.orderReference) {
        return { eventId: event.id, jobId: null };
      }
      const referencedStoreId = verified.order?.externalStoreId
        ?? verified.orderReference?.externalStoreId;
      if (
        referencedStoreId !== connection.externalStoreId
        || (verified.order && verified.order.provider !== input.provider)
      ) {
        throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
      }

      if (verified.orderReference) {
        const job = await enqueueDeliverySyncJob({
          organizationId: connection.organizationId,
          stallId: connection.stallId,
          connectionId: connection.id,
          provider: input.provider,
          jobType: "ORDER_FETCH",
          deduplicationKey: `order-fetch:${connection.id}:${verified.orderReference.externalOrderId}`,
          requestedViaCircuit: input.circuit,
          inputJson: {
            externalOrderId: verified.orderReference.externalOrderId,
            webhookEventId: event.id,
            payloadHash: verified.payloadHash,
          },
          priority: 0,
        }, transaction);
        await createWebhookAcceptedAudit(transaction, {
          eventId: event.id,
          organizationId: connection.organizationId,
          stallId: connection.stallId,
          provider: input.provider,
          circuit: input.circuit,
          processingStatus: event.processingStatus,
        });
        return { eventId: event.id, jobId: job.id };
      }

      const order = verified.order;
      if (!order) throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });

      const existingOrder = await transaction.externalOrder.findUnique({
        where: {
          connectionId_provider_externalOrderId: {
            connectionId: connection.id,
            provider: input.provider,
            externalOrderId: order.externalOrderId,
          },
        },
      });
      if (
        existingOrder
        && (
          existingOrder.connectionId !== connection.id
          || existingOrder.organizationId !== connection.organizationId
          || existingOrder.stallId !== connection.stallId
        )
      ) {
        throw new DeliveryPlatformError("PERMISSION_DENIED", { retryable: false });
      }
      const externalOrder = existingOrder ?? await transaction.externalOrder.create({
        data: {
          organizationId: connection.organizationId,
          stallId: connection.stallId,
          connectionId: connection.id,
          provider: input.provider,
          externalOrderId: order.externalOrderId,
          externalOrderNumber: order.externalOrderNumber,
          externalStoreId: order.externalStoreId,
          externalStatus: verified.eventType,
          processingStatus: "READY_FOR_IMPORT",
          currency: order.currency,
          externalSubtotalAmount: order.pricing.subtotal,
          externalDiscountAmount:
            order.pricing.platformDiscount + order.pricing.merchantDiscount,
          merchantDiscountAmount: order.pricing.merchantDiscount,
          platformDiscountAmount: order.pricing.platformDiscount,
          externalDeliveryFeeAmount: order.pricing.deliveryFee,
          externalServiceFeeAmount: order.pricing.serviceFee,
          externalTaxAmount: order.pricing.tax,
          externalTotalAmount: order.pricing.total,
          merchantReceivableAmount: order.pricing.merchantReceivable,
          scheduledPickupAt: order.scheduledPickupAt,
          payloadHash: verified.payloadHash,
          receivedViaCircuit: input.circuit,
        },
      });
      if (existingOrder?.internalOrderId) {
        await transaction.deliveryWebhookEvent.update({
          where: { id: event.id },
          data: { processingStatus: "PROCESSED", processedAt: new Date() },
        });
        return { eventId: event.id, jobId: null };
      }
      const job = await enqueueDeliverySyncJob({
        organizationId: connection.organizationId,
        stallId: connection.stallId,
        connectionId: connection.id,
        provider: input.provider,
        jobType: "ORDER_IMPORT",
        deduplicationKey: `order-import:${connection.id}:${order.externalOrderId}`,
        requestedViaCircuit: input.circuit,
        inputJson: {
          externalOrderLedgerId: externalOrder.id,
          webhookEventId: event.id,
          order: serializeNormalizedExternalOrder(order),
        },
        priority: 10,
      }, transaction);
      await createWebhookAcceptedAudit(transaction, {
        eventId: event.id,
        organizationId: connection.organizationId,
        stallId: connection.stallId,
        provider: input.provider,
        circuit: input.circuit,
        processingStatus: event.processingStatus,
      });
      return { eventId: event.id, jobId: job.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    logEvent("info", "DELIVERY_WEBHOOK_ACCEPTED", {
      provider: input.provider,
      eventId: result.eventId,
      jobId: result.jobId,
      circuit: input.circuit,
    });
    return {
      accepted: true,
      duplicate: false,
      eventId: result.eventId,
      jobId: result.jobId,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      const duplicate = await prisma.deliveryWebhookEvent.findUnique({
        where: {
          connectionId_provider_replayKey: {
            connectionId: connection.id,
            provider: input.provider,
            replayKey: verified.replayKey,
          },
        },
        select: { id: true },
      });
      if (!duplicate) throw error;
      logEvent("info", "DELIVERY_WEBHOOK_DUPLICATE", {
        provider: input.provider,
        eventId: duplicate?.id ?? null,
        circuit: input.circuit,
      });
      return {
        accepted: true,
        duplicate: true,
        eventId: duplicate?.id ?? null,
        jobId: null,
      };
    }
    await recordRejectedWebhook({
      provider: input.provider,
      connectionId: connection.id,
      organizationId: connection.organizationId,
      stallId: connection.stallId,
      circuit: input.circuit,
      payloadHash,
      signatureValid: true,
      errorCode: safeDeliveryErrorCode(error),
    });
    logEvent("warn", "DELIVERY_WEBHOOK_REJECTED", {
      provider: input.provider,
      connectionId: connection.id,
      errorCode: safeDeliveryErrorCode(error),
      circuit: input.circuit,
    });
    throw error;
  }
}

async function createWebhookAcceptedAudit(
  transaction: Prisma.TransactionClient,
  input: {
    eventId: string;
    organizationId: string;
    stallId: string;
    provider: DeliveryProvider;
    circuit: DeliveryCircuitSource;
    processingStatus: string;
  },
) {
  await transaction.auditLog.create({
    data: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      action: "DELIVERY_WEBHOOK_ACCEPTED",
      entityType: "DELIVERY_WEBHOOK_EVENT",
      entityId: input.eventId,
      outcome: "SUCCESS",
      requestId: `delivery-webhook:${input.eventId}`,
      afterJson: {
        provider: input.provider,
        circuit: input.circuit,
        processingStatus: input.processingStatus,
      },
    },
  });
}

async function recordRejectedWebhook(input: {
  provider: DeliveryProvider;
  connectionId: string;
  organizationId: string;
  stallId: string;
  circuit: DeliveryCircuitSource;
  payloadHash: string;
  signatureValid: boolean;
  errorCode: string;
}) {
  const replayKey = sha256(
    `${input.provider}:${input.connectionId}:${input.payloadHash}:rejected`,
  );
  try {
    await prisma.$transaction(async (transaction) => {
      await assertDeliveryWriter(transaction);
      await transaction.deliveryWebhookEvent.create({
        data: {
          provider: input.provider,
          connectionId: input.connectionId,
          organizationId: input.organizationId,
          stallId: input.stallId,
          eventType: "WEBHOOK_REJECTED",
          signatureValid: input.signatureValid,
          replayKey,
          payloadHash: input.payloadHash,
          receivedViaCircuit: input.circuit,
          processingStatus: "REJECTED",
          processedAt: new Date(),
          lastErrorCode: input.errorCode,
          lastErrorMessageSafe: input.errorCode,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    logEvent("error", "DELIVERY_WEBHOOK_REJECTION_LEDGER_FAILED", {
      provider: input.provider,
      errorCode: safeDeliveryErrorCode(error),
    });
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
