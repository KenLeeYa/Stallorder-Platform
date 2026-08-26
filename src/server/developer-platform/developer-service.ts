import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DeveloperCommand } from "@/server/developer-platform/developer-contract";
import { createPublicApiCredential } from "@/server/developer-platform/public-api-credentials";
import { assertPublicWebhookDestination } from "@/server/developer-platform/webhook-destination";
import {
  deleteNotificationSecret,
  storeNotificationSecret,
} from "@/server/notifications/notification-secrets";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export class DeveloperPlatformError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DeveloperPlatformError";
  }
}

async function assertPublicApiModuleEnabled(organizationId: string) {
  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_PUBLIC_API_ENABLED"],
    { organizationId, rolloutKey: organizationId },
  );
  if (!flags.MODULE_PUBLIC_API_ENABLED.enabled) {
    throw new DeveloperPlatformError("PUBLIC_API_MODULE_DISABLED");
  }
}

export async function getDeveloperPlatformDashboard(organizationId: string) {
  await assertPublicApiModuleEnabled(organizationId);
  const [apiClients, webhookEndpoints, recentDeliveries] = await Promise.all([
    prisma.publicApiClient.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.outboundWebhookEndpoint.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.outboundWebhookDelivery.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);
  return {
    apiClients: apiClients.map((client) => ({
      id: client.id,
      name: client.name,
      keyPrefix: client.keyPrefix,
      scopes: client.scopes,
      stallIds: client.stallIds,
      status: client.status,
      expiresAt: client.expiresAt?.toISOString() ?? null,
      lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
      createdAt: client.createdAt.toISOString(),
    })),
    webhookEndpoints: webhookEndpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      eventTypes: endpoint.eventTypes,
      secretVersion: endpoint.secretVersion,
      status: endpoint.status,
      consecutiveFailures: endpoint.consecutiveFailures,
      lastSuccessfulAt: endpoint.lastSuccessfulAt?.toISOString() ?? null,
      lastErrorCode: endpoint.lastErrorCode,
      createdAt: endpoint.createdAt.toISOString(),
    })),
    recentDeliveries: recentDeliveries.map((delivery) => ({
      id: delivery.id,
      endpointId: delivery.endpointId,
      eventType: delivery.eventType,
      payloadVersion: delivery.payloadVersion,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      lastResponseStatus: delivery.lastResponseStatus,
      lastErrorCode: delivery.lastErrorCode,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    })),
  };
}

export async function applyDeveloperCommand(input: {
  organizationId: string;
  actorProfileId: string;
  command: DeveloperCommand;
}) {
  await assertPublicApiModuleEnabled(input.organizationId);
  try {
    switch (input.command.operation) {
      case "CREATE_API_KEY":
        return createApiKey({ ...input, command: input.command });
      case "REVOKE_API_KEY":
        return revokeApiKey({ ...input, command: input.command });
      case "CREATE_WEBHOOK_ENDPOINT":
        return createWebhookEndpoint({ ...input, command: input.command });
      case "SET_WEBHOOK_STATUS":
        return setWebhookStatus({ ...input, command: input.command });
      case "ROTATE_WEBHOOK_SECRET":
        return rotateWebhookSecret({ ...input, command: input.command });
    }
  } catch (error) {
    if (error instanceof DeveloperPlatformError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DeveloperPlatformError("DEVELOPER_DUPLICATE_RECORD");
    }
    if (error instanceof Error && error.message === "WEBHOOK_DESTINATION_UNSAFE") {
      throw new DeveloperPlatformError("WEBHOOK_DESTINATION_UNSAFE");
    }
    throw error;
  }
}

async function createApiKey(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<DeveloperCommand, { operation: "CREATE_API_KEY" }>;
}) {
  const expiresAt = input.command.expiresAt ? new Date(input.command.expiresAt) : null;
  if (expiresAt && expiresAt <= new Date()) {
    throw new DeveloperPlatformError("PUBLIC_API_EXPIRY_INVALID");
  }
  if (input.command.stallIds.length) {
    const count = await prisma.stall.count({
      where: {
        organizationId: input.organizationId,
        id: { in: input.command.stallIds },
        isActive: true,
      },
    });
    if (count !== input.command.stallIds.length) {
      throw new DeveloperPlatformError("PUBLIC_API_STALL_SCOPE_INVALID");
    }
  }
  const credential = createPublicApiCredential();
  const client = await prisma.publicApiClient.create({
    data: {
      organizationId: input.organizationId,
      name: input.command.name,
      keyPrefix: credential.keyPrefix,
      keyHash: credential.keyHash,
      scopes: input.command.scopes,
      stallIds: input.command.stallIds,
      expiresAt,
      createdByProfileId: input.actorProfileId,
    },
  });
  return { id: client.id, oneTimeSecret: credential.rawKey, secretKind: "API_KEY" as const };
}

async function revokeApiKey(input: {
  organizationId: string;
  command: Extract<DeveloperCommand, { operation: "REVOKE_API_KEY" }>;
}) {
  const result = await prisma.publicApiClient.updateMany({
    where: { id: input.command.clientId, organizationId: input.organizationId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: input.command.reason },
  });
  if (result.count !== 1) throw new DeveloperPlatformError("PUBLIC_API_CLIENT_NOT_FOUND");
  return { id: input.command.clientId, oneTimeSecret: null, secretKind: null };
}

async function createWebhookEndpoint(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<DeveloperCommand, { operation: "CREATE_WEBHOOK_ENDPOINT" }>;
}) {
  return prisma.$transaction(async (transaction) => {
    const endpointId = randomUUID();
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const secretReference = await storeNotificationSecret(
      `stallorder_outbound_webhook_${endpointId.replaceAll("-", "_")}_v1`,
      secret,
      "StallOrder outbound webhook signing secret",
      transaction,
    );
    const endpoint = await transaction.outboundWebhookEndpoint.create({
      data: {
        id: endpointId,
        organizationId: input.organizationId,
        name: input.command.name,
        url: input.command.url,
        eventTypes: input.command.eventTypes,
        secretReference,
        status: "DISABLED",
        createdByProfileId: input.actorProfileId,
      },
    });
    return { id: endpoint.id, oneTimeSecret: secret, secretKind: "WEBHOOK_SECRET" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function setWebhookStatus(input: {
  organizationId: string;
  command: Extract<DeveloperCommand, { operation: "SET_WEBHOOK_STATUS" }>;
}) {
  const endpoint = await prisma.outboundWebhookEndpoint.findFirst({
    where: { id: input.command.endpointId, organizationId: input.organizationId },
  });
  if (!endpoint) throw new DeveloperPlatformError("WEBHOOK_ENDPOINT_NOT_FOUND");
  if (input.command.status === "ACTIVE") {
    await assertPublicWebhookDestination(endpoint.url);
  }
  return prisma.outboundWebhookEndpoint.update({
    where: { id: endpoint.id },
    data: {
      status: input.command.status,
      ...(input.command.status === "DISABLED" ? { lastErrorCode: null, consecutiveFailures: 0 } : {}),
    },
  }).then((updated) => ({ id: updated.id, oneTimeSecret: null, secretKind: null }));
}

async function rotateWebhookSecret(input: {
  organizationId: string;
  command: Extract<DeveloperCommand, { operation: "ROTATE_WEBHOOK_SECRET" }>;
}) {
  return prisma.$transaction(async (transaction) => {
    const endpoint = await transaction.outboundWebhookEndpoint.findFirst({
      where: { id: input.command.endpointId, organizationId: input.organizationId },
    });
    if (!endpoint) throw new DeveloperPlatformError("WEBHOOK_ENDPOINT_NOT_FOUND");
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const nextVersion = endpoint.secretVersion + 1;
    const secretReference = await storeNotificationSecret(
      `stallorder_outbound_webhook_${endpoint.id.replaceAll("-", "_")}_v${nextVersion}`,
      secret,
      "Rotated StallOrder outbound webhook signing secret",
      transaction,
    );
    await transaction.outboundWebhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        secretReference,
        secretVersion: nextVersion,
        status: "DISABLED",
        lastErrorCode: null,
        consecutiveFailures: 0,
      },
    });
    await deleteNotificationSecret(endpoint.secretReference, transaction);
    return { id: endpoint.id, oneTimeSecret: secret, secretKind: "WEBHOOK_SECRET" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
