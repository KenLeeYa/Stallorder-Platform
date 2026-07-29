import "server-only";

import { prisma } from "@/lib/prisma";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import type { DeliveryCircuitSource } from "./delivery-platform-types";
import { assertDeliveryWriter } from "./writer-guard";

type InternalEntityType = "CATEGORY" | "PRODUCT" | "MODIFIER_GROUP" | "MODIFIER_ITEM";

export function listExternalMenuMappings(connectionId: string) {
  return prisma.externalMenuMapping.findMany({
    where: { connectionId },
    orderBy: [{ internalEntityType: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      connectionId: true,
      provider: true,
      internalEntityType: true,
      internalEntityId: true,
      externalEntityId: true,
      externalParentId: true,
      mappingStatus: true,
      lastSyncedAt: true,
      lastErrorCode: true,
      updatedAt: true,
    },
  });
}

export async function upsertExternalMenuMapping(input: {
  organizationId: string;
  stallId: string;
  connectionId: string;
  internalEntityType: InternalEntityType;
  internalEntityId: string;
  externalEntityId: string;
  externalParentId?: string | null;
  actorProfileId: string;
  requestId: string;
  ipHash: string;
  circuit: DeliveryCircuitSource;
}) {
  const connection = await prisma.deliveryPlatformConnection.findFirst({
    where: {
      id: input.connectionId,
      organizationId: input.organizationId,
      stallId: input.stallId,
    },
  });
  if (!connection) throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
  if (!await internalEntityExists(
    input.organizationId,
    input.internalEntityType,
    input.internalEntityId,
  )) {
    throw new DeliveryPlatformError("UNSUPPORTED_MAPPING", { retryable: false });
  }
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    const mapping = await transaction.externalMenuMapping.upsert({
      where: {
        connectionId_internalEntityType_internalEntityId: {
          connectionId: connection.id,
          internalEntityType: input.internalEntityType,
          internalEntityId: input.internalEntityId,
        },
      },
      update: {
        externalEntityId: input.externalEntityId,
        externalParentId: input.externalParentId,
        mappingStatus: "MAPPED",
        lastErrorCode: null,
      },
      create: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        connectionId: connection.id,
        provider: connection.provider,
        internalEntityType: input.internalEntityType,
        internalEntityId: input.internalEntityId,
        externalEntityId: input.externalEntityId,
        externalParentId: input.externalParentId,
        mappingStatus: "MAPPED",
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        actorProfileId: input.actorProfileId,
        action: "DELIVERY_MENU_MAPPING_UPDATED",
        entityType: "EXTERNAL_MENU_MAPPING",
        entityId: mapping.id,
        outcome: "SUCCESS",
        requestId: input.requestId,
        ipHash: input.ipHash,
        afterJson: {
          internalEntityType: input.internalEntityType,
          mappingStatus: mapping.mappingStatus,
          circuit: input.circuit,
        },
      },
    });
    return mapping;
  });
}

async function internalEntityExists(
  organizationId: string,
  type: InternalEntityType,
  id: string,
) {
  if (type === "CATEGORY") {
    return Boolean(await prisma.productCategory.findFirst({
      where: { id, organizationId },
      select: { id: true },
    }));
  }
  if (type === "PRODUCT") {
    return Boolean(await prisma.product.findFirst({
      where: { id, organizationId },
      select: { id: true },
    }));
  }
  if (type === "MODIFIER_GROUP") {
    return Boolean(await prisma.productNoteGroup.findFirst({
      where: { id, organizationId },
      select: { id: true },
    }));
  }
  return Boolean(await prisma.productNoteOption.findFirst({
    where: { id, organizationId },
    select: { id: true },
  }));
}
