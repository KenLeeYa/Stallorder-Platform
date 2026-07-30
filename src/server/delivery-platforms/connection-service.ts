import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/server/billing/entitlement-service";
import { assertDeliveryProviderEnabled } from "./delivery-feature-flags";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import { deliveryPlatformRepository } from "./delivery-platform-repository";
import { getDeliveryPlatformAdapter } from "./delivery-platform-registry";
import { isProductionDeliveryRuntime } from "./delivery-environment";
import type {
  DeliveryPlatformCapability,
  DeliveryProvider,
} from "./delivery-platform-types";
import { assertDeliveryWriter } from "./writer-guard";

type AuditEvidence = {
  actorProfileId: string;
  requestId: string;
  ipHash: string;
};

export async function getMerchantDeliveryIntegrationData(
  organizationId: string,
  stallIds?: readonly string[],
) {
  const [connections, requests] = await Promise.all([
    deliveryPlatformRepository.listConnections(organizationId, stallIds),
    deliveryPlatformRepository.listConnectionRequests(organizationId, stallIds),
  ]);
  return { connections, requests };
}

export async function submitDeliveryConnectionRequest(input: {
  organizationId: string;
  stallId: string;
  provider: Exclude<DeliveryProvider, "MOCK">;
  merchantContactName: string;
  merchantContactEmail: string;
  merchantContactPhone?: string | null;
  externalVendorCode?: string | null;
  externalChainCode?: string | null;
  currentProvider?: string | null;
  requestedCapabilities: DeliveryPlatformCapability[];
  merchantNote?: string | null;
  audit: AuditEvidence;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await assertDeliveryWriter(transaction);
      const stall = await transaction.stall.findFirst({
        where: {
          id: input.stallId,
          organizationId: input.organizationId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!stall) throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
      const request = await transaction.deliveryPlatformConnectionRequest.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          provider: input.provider,
          requestedByProfileId: input.audit.actorProfileId,
          merchantContactName: input.merchantContactName,
          merchantContactEmail: input.merchantContactEmail.toLowerCase(),
          merchantContactPhone: input.merchantContactPhone,
          externalVendorCode: input.externalVendorCode,
          externalChainCode: input.externalChainCode,
          currentProvider: input.currentProvider,
          requestedCapabilitiesJson: input.requestedCapabilities,
          status: "SUBMITTED",
          merchantNote: input.merchantNote,
          submittedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          actorProfileId: input.audit.actorProfileId,
          action: "DELIVERY_CONNECTION_REQUESTED",
          entityType: "DELIVERY_CONNECTION_REQUEST",
          entityId: request.id,
          outcome: "SUCCESS",
          requestId: input.audit.requestId,
          ipHash: input.audit.ipHash,
          afterJson: {
            provider: input.provider,
            status: request.status,
            capabilities: input.requestedCapabilities,
          },
        },
      });
      return request;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof DeliveryPlatformError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
    }
    throw error;
  }
}

export async function reviewDeliveryConnectionRequest(input: {
  requestId: string;
  action: "REQUEST_INFORMATION" | "APPROVE_CONFIGURATION" | "REJECT";
  adminNote: string;
  audit: AuditEvidence;
}) {
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    await transaction.$queryRaw`
      select id
      from public.delivery_platform_connection_requests
      where id = ${input.requestId}::uuid
      for update
    `;
    const request = await transaction.deliveryPlatformConnectionRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!request) throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
    if (request.status !== "SUBMITTED" && request.status !== "NEEDS_INFORMATION") {
      throw new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
    }
    const nextStatus = input.action === "REQUEST_INFORMATION"
      ? "NEEDS_INFORMATION"
      : input.action === "REJECT"
        ? "REJECTED"
        : "APPROVED_FOR_CONFIGURATION";
    const reviewed = await transaction.deliveryPlatformConnectionRequest.update({
      where: { id: request.id },
      data: {
        status: nextStatus,
        adminNote: input.adminNote,
        reviewedAt: new Date(),
        reviewedByProfileId: input.audit.actorProfileId,
      },
    });
    let connectionId: string | null = null;
    if (input.action === "APPROVE_CONFIGURATION") {
      const connection = await transaction.deliveryPlatformConnection.create({
        data: {
          organizationId: request.organizationId,
          stallId: request.stallId,
          provider: request.provider,
          status: request.provider === "UBER_EATS"
            ? "PENDING_AUTHORIZATION"
            : "PENDING_PARTNER_APPROVAL",
          reviewedByProfileId: input.audit.actorProfileId,
          capabilitiesJson: request.requestedCapabilitiesJson as Prisma.InputJsonValue,
        },
      });
      connectionId = connection.id;
    }
    await transaction.auditLog.create({
      data: {
        organizationId: request.organizationId,
        stallId: request.stallId,
        actorProfileId: input.audit.actorProfileId,
        action: input.action === "REQUEST_INFORMATION"
          ? "DELIVERY_CONNECTION_INFORMATION_REQUESTED"
          : input.action === "REJECT"
            ? "DELIVERY_CONNECTION_REJECTED"
            : "DELIVERY_CONNECTION_CONFIGURATION_APPROVED",
        entityType: "DELIVERY_CONNECTION_REQUEST",
        entityId: request.id,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        beforeJson: { status: request.status },
        afterJson: { status: reviewed.status, connectionId },
      },
    });
    return { request: reviewed, connectionId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setDeliveryConnectionStatus(input: {
  connectionId: string;
  nextStatus: "TESTING" | "ACTIVE" | "PAUSED" | "DISCONNECTED";
  audit: AuditEvidence;
}) {
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    await transaction.$queryRaw`
      select id
      from public.delivery_platform_connections
      where id = ${input.connectionId}::uuid
      for update
    `;
    const connection = await transaction.deliveryPlatformConnection.findUnique({
      where: { id: input.connectionId },
    });
    if (!connection) throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
    const allowed: Record<string, readonly string[]> = {
      PENDING_AUTHORIZATION: ["TESTING", "DISCONNECTED"],
      PENDING_PARTNER_APPROVAL: ["TESTING", "DISCONNECTED"],
      PENDING_STORE_MAPPING: ["TESTING", "DISCONNECTED"],
      CONFIGURING: ["TESTING", "DISCONNECTED"],
      TESTING: ["ACTIVE", "PAUSED", "DISCONNECTED"],
      ACTIVE: ["PAUSED", "DISCONNECTED"],
      PAUSED: ["TESTING", "ACTIVE", "DISCONNECTED"],
      ERROR: ["TESTING", "PAUSED", "DISCONNECTED"],
    };
    if (!allowed[connection.status]?.includes(input.nextStatus)) {
      throw new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
    }
    if (
      input.nextStatus === "ACTIVE"
      && (
        !connection.externalStoreId
        || (connection.provider !== "MOCK" && !connection.credentialReference)
        || (connection.provider === "MOCK" && isProductionDeliveryRuntime())
      )
    ) {
      throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
    }
    const now = new Date();
    const updated = await transaction.deliveryPlatformConnection.update({
      where: { id: connection.id },
      data: {
        status: input.nextStatus,
        reviewedByProfileId: input.audit.actorProfileId,
        activatedAt: input.nextStatus === "ACTIVE" ? now : connection.activatedAt,
        pausedAt: input.nextStatus === "PAUSED" ? now : null,
        disconnectedAt: input.nextStatus === "DISCONNECTED" ? now : null,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: connection.organizationId,
        stallId: connection.stallId,
        actorProfileId: input.audit.actorProfileId,
        action: `DELIVERY_CONNECTION_${input.nextStatus}`,
        entityType: "DELIVERY_CONNECTION",
        entityId: connection.id,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        beforeJson: { status: connection.status },
        afterJson: { status: updated.status },
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createSyntheticMockConnection(input: {
  organizationId: string;
  stallId: string;
  audit: AuditEvidence;
}) {
  if (isProductionDeliveryRuntime()) {
    throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
  }
  await assertDeliveryProviderEnabled("MOCK", {
    organizationId: input.organizationId,
    stallId: input.stallId,
  });
  await entitlementService.assertFeatureEnabled(
    input.organizationId,
    "DELIVERY_PLATFORM_INTEGRATIONS",
  );
  const adapter = getDeliveryPlatformAdapter("MOCK");
  const [store] = await adapter.listExternalStores({
    connection: {
      id: "00000000-0000-4000-8000-000000000000",
      organizationId: input.organizationId,
      stallId: input.stallId,
      provider: "MOCK",
      externalStoreId: null,
      credentialReference: null,
    },
  });
  if (!store) throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    const stall = await transaction.stall.findFirst({
      where: {
        id: input.stallId,
        organizationId: input.organizationId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!stall) throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
    const connection = await transaction.deliveryPlatformConnection.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        provider: "MOCK",
        status: "TESTING",
        externalChainId: store.chainId,
        externalStoreId: store.id,
        externalStoreName: store.name,
        externalAccountReference: "synthetic-account",
        capabilitiesJson: adapter.getConnectionCapabilities(),
        connectedByProfileId: input.audit.actorProfileId,
        reviewedByProfileId: input.audit.actorProfileId,
        connectedAt: new Date(),
      },
    });
    await transaction.externalStoreMapping.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        connectionId: connection.id,
        provider: "MOCK",
        externalChainId: store.chainId,
        externalStoreId: store.id,
        externalStoreName: store.name,
        mappingStatus: "VERIFIED",
        verifiedAt: new Date(),
        verifiedByProfileId: input.audit.actorProfileId,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        actorProfileId: input.audit.actorProfileId,
        action: "DELIVERY_SYNTHETIC_CONNECTION_CREATED",
        entityType: "DELIVERY_CONNECTION",
        entityId: connection.id,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        afterJson: { provider: "MOCK", status: "TESTING" },
      },
    });
    return connection;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
