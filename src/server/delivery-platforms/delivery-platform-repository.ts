import "server-only";

import { prisma } from "@/lib/prisma";

export const deliveryConnectionSafeSelect = {
  id: true,
  organizationId: true,
  stallId: true,
  provider: true,
  status: true,
  externalChainId: true,
  externalStoreId: true,
  externalStoreName: true,
  capabilitiesJson: true,
  connectedAt: true,
  activatedAt: true,
  pausedAt: true,
  disconnectedAt: true,
  lastHealthCheckAt: true,
  lastSuccessfulSyncAt: true,
  lastErrorCode: true,
  lastErrorAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class DeliveryPlatformRepository {
  listConnections(organizationId: string, stallIds?: readonly string[]) {
    return prisma.deliveryPlatformConnection.findMany({
      where: {
        organizationId,
        stallId: stallIds ? { in: [...stallIds] } : undefined,
      },
      orderBy: [{ stallId: "asc" }, { createdAt: "desc" }],
      select: deliveryConnectionSafeSelect,
    });
  }

  listConnectionRequests(organizationId: string, stallIds?: readonly string[]) {
    return prisma.deliveryPlatformConnectionRequest.findMany({
      where: {
        organizationId,
        stallId: stallIds ? { in: [...stallIds] } : undefined,
      },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        organizationId: true,
        stallId: true,
        provider: true,
        merchantContactName: true,
        merchantContactEmail: true,
        merchantContactPhone: true,
        externalVendorCode: true,
        externalChainCode: true,
        currentProvider: true,
        requestedCapabilitiesJson: true,
        status: true,
        merchantNote: true,
        submittedAt: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findConnection(connectionId: string) {
    return prisma.deliveryPlatformConnection.findUnique({
      where: { id: connectionId },
    });
  }

  findScopedConnection(connectionId: string, organizationId: string, stallId?: string) {
    return prisma.deliveryPlatformConnection.findFirst({
      where: {
        id: connectionId,
        organizationId,
        stallId,
      },
      select: deliveryConnectionSafeSelect,
    });
  }

  listExternalOrders(connectionId: string, organizationId: string, stallId: string) {
    return prisma.externalOrder.findMany({
      where: { connectionId, organizationId, stallId },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: {
        id: true,
        provider: true,
        externalOrderNumber: true,
        externalStatus: true,
        processingStatus: true,
        currency: true,
        externalSubtotalAmount: true,
        externalTotalAmount: true,
        platformDiscountAmount: true,
        merchantDiscountAmount: true,
        merchantReceivableAmount: true,
        receivedViaCircuit: true,
        scheduledPickupAt: true,
        receivedAt: true,
        lastSyncedAt: true,
        internalOrderId: true,
      },
    });
  }

  listSafeConnectionLogs(connectionId: string, organizationId: string, stallId: string) {
    return Promise.all([
      prisma.deliverySyncJob.findMany({
        where: { connectionId, organizationId, stallId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          provider: true,
          jobType: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          requestedViaCircuit: true,
          scheduledAt: true,
          startedAt: true,
          completedAt: true,
          nextAttemptAt: true,
          lastErrorCode: true,
          createdAt: true,
        },
      }),
      prisma.deliveryWebhookEvent.findMany({
        where: { connectionId, organizationId, stallId },
        orderBy: { receivedAt: "desc" },
        take: 100,
        select: {
          id: true,
          provider: true,
          eventType: true,
          signatureValid: true,
          receivedViaCircuit: true,
          processingStatus: true,
          attemptCount: true,
          receivedAt: true,
          processedAt: true,
          lastErrorCode: true,
        },
      }),
    ]).then(([jobs, webhooks]) => ({ jobs, webhooks }));
  }

  listPlatformAdminData() {
    return Promise.all([
      prisma.deliveryPlatformConnectionRequest.findMany({
        orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
        take: 200,
        select: {
          id: true,
          organizationId: true,
          stallId: true,
          provider: true,
          merchantContactName: true,
          merchantContactEmail: true,
          externalVendorCode: true,
          externalChainCode: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          createdAt: true,
        },
      }),
      prisma.deliveryPlatformConnection.findMany({
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          ...deliveryConnectionSafeSelect,
        },
      }),
      prisma.deliverySyncJob.findMany({
        where: { status: { in: ["FAILED", "DEAD_LETTER"] } },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          organizationId: true,
          stallId: true,
          connectionId: true,
          provider: true,
          jobType: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          requestedViaCircuit: true,
          lastErrorCode: true,
          updatedAt: true,
        },
      }),
    ]).then(([requests, connections, failedJobs]) => ({
      requests,
      connections,
      failedJobs,
    }));
  }
}

export const deliveryPlatformRepository = new DeliveryPlatformRepository();
