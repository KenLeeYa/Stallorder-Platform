import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import { getDeliveryPlatformAdapter } from "./delivery-platform-registry";
import type { DeliveryCircuitSource } from "./delivery-platform-types";
import { assertDeliveryWriter } from "./writer-guard";

type MappingAudit = {
  actorProfileId: string;
  requestId: string;
  ipHash: string;
  circuit: DeliveryCircuitSource;
};

export async function listExternalStores(connectionId: string) {
  const connection = await prisma.deliveryPlatformConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection) throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
  const adapter = getDeliveryPlatformAdapter(connection.provider as "UBER_EATS" | "FOODPANDA" | "MOCK");
  return adapter.listExternalStores({
    connection: {
      id: connection.id,
      organizationId: connection.organizationId,
      stallId: connection.stallId,
      provider: connection.provider as "UBER_EATS" | "FOODPANDA" | "MOCK",
      externalStoreId: connection.externalStoreId,
      credentialReference: connection.credentialReference,
    },
  });
}

export async function selectExternalStore(input: {
  connectionId: string;
  organizationId: string;
  stallId: string;
  externalStoreId: string;
  idempotencyKey: string;
  audit: MappingAudit;
}) {
  const connection = await prisma.deliveryPlatformConnection.findFirst({
    where: {
      id: input.connectionId,
      organizationId: input.organizationId,
      stallId: input.stallId,
    },
  });
  if (!connection) throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
  const provider = connection.provider as "UBER_EATS" | "FOODPANDA" | "MOCK";
  const adapter = getDeliveryPlatformAdapter(provider);
  const selected = await adapter.activateStoreConnection({
    connection: {
      id: connection.id,
      organizationId: connection.organizationId,
      stallId: connection.stallId,
      provider,
      externalStoreId: connection.externalStoreId,
      credentialReference: connection.credentialReference,
    },
    externalStoreId: input.externalStoreId,
    idempotencyKey: input.idempotencyKey,
  });
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    const mapping = await transaction.externalStoreMapping.upsert({
      where: {
        connectionId_externalStoreId: {
          connectionId: connection.id,
          externalStoreId: selected.externalStoreId,
        },
      },
      update: {
        externalStoreName: selected.externalStoreName,
        mappingStatus: "UNVERIFIED",
        verifiedAt: null,
        verifiedByProfileId: null,
      },
      create: {
        organizationId: connection.organizationId,
        stallId: connection.stallId,
        connectionId: connection.id,
        provider,
        externalChainId: connection.externalChainId,
        externalStoreId: selected.externalStoreId,
        externalStoreName: selected.externalStoreName,
      },
    });
    await transaction.deliveryPlatformConnection.update({
      where: { id: connection.id },
      data: {
        externalStoreId: selected.externalStoreId,
        externalStoreName: selected.externalStoreName,
        status: "PENDING_STORE_MAPPING",
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: connection.organizationId,
        stallId: connection.stallId,
        actorProfileId: input.audit.actorProfileId,
        action: "DELIVERY_CONNECTION_STORE_SELECTED",
        entityType: "EXTERNAL_STORE_MAPPING",
        entityId: mapping.id,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        afterJson: {
          provider,
          externalStoreId: selected.externalStoreId,
          circuit: input.audit.circuit,
        },
      },
    });
    return mapping;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function verifyExternalStoreMapping(input: {
  mappingId: string;
  audit: MappingAudit;
}) {
  return prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    const mapping = await transaction.externalStoreMapping.findUnique({
      where: { id: input.mappingId },
    });
    if (!mapping) throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
    const verified = await transaction.externalStoreMapping.update({
      where: { id: mapping.id },
      data: {
        mappingStatus: "VERIFIED",
        verifiedAt: new Date(),
        verifiedByProfileId: input.audit.actorProfileId,
      },
    });
    await transaction.deliveryPlatformConnection.update({
      where: { id: mapping.connectionId },
      data: { status: "TESTING" },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: mapping.organizationId,
        stallId: mapping.stallId,
        actorProfileId: input.audit.actorProfileId,
        action: "DELIVERY_CONNECTION_STORE_MAPPED",
        entityType: "EXTERNAL_STORE_MAPPING",
        entityId: mapping.id,
        outcome: "SUCCESS",
        requestId: input.audit.requestId,
        ipHash: input.audit.ipHash,
        beforeJson: { status: mapping.mappingStatus },
        afterJson: { status: verified.mappingStatus, circuit: input.audit.circuit },
      },
    });
    return verified;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
