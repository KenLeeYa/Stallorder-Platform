import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/server/billing/entitlement-service";
import { assertDeliveryProviderEnabled } from "./delivery-feature-flags";
import { getDeliveryPlatformAdapter } from "./delivery-platform-registry";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import type {
  DeliveryCircuitSource,
  DeliveryProvider,
} from "./delivery-platform-types";
import { enqueueDeliverySyncJob } from "./sync-job-service";

type ExternalTransitionStatus =
  | "CONFIRMED"
  | "PREPARING"
  | "PACKING"
  | "READY"
  | "CANCELLED"
  | "COMPLETED";

type ExternalTransitionContext = {
  id: string;
  provider: DeliveryProvider;
  connectionId: string;
  organizationId: string;
  stallId: string;
  externalOrderId: string;
};

export async function acknowledgeExternalOrderBeforeTransition(input: {
  orderId: string;
  nextStatus: ExternalTransitionStatus;
}): Promise<ExternalTransitionContext | null> {
  const externalOrder = await prisma.externalOrder.findFirst({
    where: { internalOrderId: input.orderId },
  });
  if (!externalOrder) return null;
  const provider = externalOrder.provider as DeliveryProvider;
  const external = {
    id: externalOrder.id,
    provider,
    connectionId: externalOrder.connectionId,
    organizationId: externalOrder.organizationId,
    stallId: externalOrder.stallId,
    externalOrderId: externalOrder.externalOrderId,
  };
  if (input.nextStatus !== "CONFIRMED" && input.nextStatus !== "CANCELLED") {
    return external;
  }
  const state = await assertDeliveryProviderEnabled(provider, {
    organizationId: externalOrder.organizationId,
    stallId: externalOrder.stallId,
  });
  if (!state.providerActions) {
    throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
  }
  await entitlementService.assertFeatureEnabled(
    externalOrder.organizationId,
    "DELIVERY_PLATFORM_INTEGRATIONS",
  );
  const connection = await prisma.deliveryPlatformConnection.findFirst({
    where: {
      id: externalOrder.connectionId,
      organizationId: externalOrder.organizationId,
      stallId: externalOrder.stallId,
      provider,
      status: "ACTIVE",
    },
  });
  if (!connection) {
    throw new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
  }
  const adapter = getDeliveryPlatformAdapter(provider);
  const actionInput = {
    connection: {
      id: connection.id,
      organizationId: connection.organizationId,
      stallId: connection.stallId,
      provider,
      externalStoreId: connection.externalStoreId,
      credentialReference: connection.credentialReference,
    },
    externalOrderId: externalOrder.externalOrderId,
    idempotencyKey: deliveryActionIdempotencyKey(
      provider,
      externalOrder.externalOrderId,
      input.nextStatus,
    ),
    reasonCode: input.nextStatus === "CANCELLED" ? "MERCHANT_REJECTED" : undefined,
  };
  if (input.nextStatus === "CONFIRMED") {
    await adapter.acceptOrder(actionInput);
  } else {
    await adapter.rejectOrder(actionInput);
  }
  return external;
}

export async function persistExternalOrderTransition(
  transaction: Prisma.TransactionClient,
  external: ExternalTransitionContext | null,
  nextStatus: ExternalTransitionStatus,
  circuit: DeliveryCircuitSource = "CIRCUIT_B_VERCEL",
) {
  if (!external) return;
  const now = new Date();
  await transaction.externalOrder.update({
    where: { id: external.id },
    data: {
      externalStatus: nextStatus,
      processingStatus: nextStatus === "CANCELLED"
        ? "REJECTED"
        : nextStatus === "CONFIRMED"
          ? "CONFIRMED"
          : undefined,
      acceptedAt: nextStatus === "CONFIRMED" ? now : undefined,
      rejectedAt: nextStatus === "CANCELLED" ? now : undefined,
      completedAt: nextStatus === "COMPLETED" ? now : undefined,
      lastSyncedAt: now,
    },
  });
  const jobType = nextStatus === "PREPARING"
    ? "ORDER_PREPARING"
    : nextStatus === "READY"
      ? "ORDER_READY"
      : null;
  if (!jobType) return;
  await enqueueDeliverySyncJob({
    organizationId: external.organizationId,
    stallId: external.stallId,
    connectionId: external.connectionId,
    provider: external.provider,
    jobType,
    deduplicationKey: `order-action:${external.provider}:${external.externalOrderId}:${nextStatus}`,
    requestedViaCircuit: circuit,
    inputJson: {
      externalOrderId: external.externalOrderId,
      idempotencyKey: deliveryActionIdempotencyKey(
        external.provider,
        external.externalOrderId,
        nextStatus,
      ),
    },
    priority: 20,
  }, transaction);
}

export async function persistExternalOrderTransitionForOrder(
  transaction: Prisma.TransactionClient,
  orderId: string,
  nextStatus: ExternalTransitionStatus,
  circuit: DeliveryCircuitSource = "CIRCUIT_B_VERCEL",
) {
  const externalOrder = await transaction.externalOrder.findFirst({
    where: { internalOrderId: orderId },
    select: {
      id: true,
      provider: true,
      connectionId: true,
      organizationId: true,
      stallId: true,
      externalOrderId: true,
    },
  });
  if (!externalOrder) return;
  await persistExternalOrderTransition(
    transaction,
    {
      ...externalOrder,
      provider: externalOrder.provider as DeliveryProvider,
    },
    nextStatus,
    circuit,
  );
}

export function deliveryActionIdempotencyKey(
  provider: string,
  externalOrderId: string,
  action: string,
) {
  return `stallorder:${provider}:${externalOrderId}:${action}`.slice(0, 240);
}
