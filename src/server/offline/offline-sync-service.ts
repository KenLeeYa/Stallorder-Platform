import "server-only";

import { createHash } from "node:crypto";
import {
  Prisma,
  type OrderItemStatus,
  type OrderStatus,
  type UserRole,
} from "@prisma/client";
import { z } from "zod";
import {
  offlineCashEventSchema,
  offlineOrderSchema,
  type OfflineOrder,
  type OfflineOrderItem,
  type OfflineOrderState,
  type OfflineOrderSyncRecord,
  type OfflineSyncConflictType,
  type OfflineSyncReceipt,
  type OfflineSyncRecord,
} from "@/offline/offline-order-contract";
import { getCashShiftRuntimeTotals } from "@/lib/cash-shifts";
import { orderItemsExceedLimits } from "@/lib/order-item-limits";
import { prisma } from "@/lib/prisma";
import { createOpaqueToken, hashToken, safeEqual } from "@/lib/security";
import { EntitlementService } from "@/server/billing/entitlement-service";
import {
  requireOfflinePermitSigningSecret,
  verifyOfflinePermit,
  type OfflinePermitPayload,
} from "@/server/offline/offline-permit";
import {
  matchesExistingOrderReplay,
  rejectedInboxReplayErrorCode,
} from "@/server/offline/offline-sync-replay";
import { validateOfflineEventChain } from "@/server/offline/offline-sync-validation";

const MANAGER_ROLES = new Set<UserRole>([
  "PLATFORM_ADMIN",
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "STALL_MANAGER",
]);
const ACTIVE_DEVICE_STATUSES = new Set(["ACTIVE"]);
const CLOCK_SKEW_WARNING_MS = 5 * 60_000;
const CLOCK_SKEW_MAXIMUM_MS = 24 * 60 * 60_000;

const snapshotOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  priceDelta: z.number().int().min(-100_000_000).max(100_000_000),
  sortOrder: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
}).passthrough();

const snapshotGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  selectionMode: z.enum(["SINGLE", "MULTIPLE"]),
  isRequired: z.boolean(),
  minSelections: z.number().int().min(0).max(50),
  maxSelections: z.number().int().min(0).max(50).nullable(),
  isActive: z.boolean(),
  options: z.array(snapshotOptionSchema).max(100),
}).passthrough();

const snapshotCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  stall: z.object({
    id: z.string().uuid(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }).passthrough(),
  limits: z.object({
    maxItemQuantity: z.number().int().min(1).max(100),
    maxUniqueProducts: z.number().int().min(1).max(100),
    maxTotalQuantity: z.number().int().min(1).max(1_000),
    maxNoteLength: z.number().int().min(0).max(1_000),
  }).strict(),
  products: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    price: z.number().int().min(0).max(100_000_000),
    isActive: z.boolean(),
    isEnabled: z.boolean(),
    isSoldOut: z.boolean(),
    availableFrom: z.string().datetime({ offset: true }).nullable(),
    availableUntil: z.string().datetime({ offset: true }).nullable(),
    noteGroups: z.array(snapshotGroupSchema).max(50),
  }).passthrough()).max(10_000),
  paymentOptions: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    kind: z.enum(["CASH", "LINE_PAY", "JKO_PAY", "CUSTOM"]),
  }).passthrough()).max(100),
}).passthrough();

type SyncActor = {
  profileId: string;
  roles: UserRole[];
  requestId: string;
  ipHash: string;
};

type SharedSyncContext = {
  organizationId: string;
  stallId: string;
  actor: SyncActor;
  clientSentAt: Date;
  permit: OfflinePermitPayload;
  permitRecord: {
    id: string;
    status: string;
    issuedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  };
  device: {
    id: string;
    status: string;
    offlineEnabled: boolean;
    offlineRole: string;
    revokedAt: Date | null;
    updatedAt: Date;
  };
  runtime: {
    promotionEpoch: bigint;
  };
};

type PreparedSnapshotItem = OfflineOrderItem & {
  canonicalProductId: string | null;
  canonicalNoteOptions: Array<OfflineOrderItem["noteOptions"][number] & {
    canonicalNoteGroupId: string | null;
    canonicalNoteOptionId: string | null;
  }>;
};

export class OfflineSyncOperationError extends Error {
  constructor(public readonly code:
    | "OFFLINE_SYNC_AUTH_INVALID"
    | "OFFLINE_SYNC_SCOPE_INVALID"
    | "OFFLINE_SYNC_DEVICE_INVALID"
    | "OFFLINE_SYNC_PERMIT_INVALID"
    | "OFFLINE_SYNC_PROTOCOL_INVALID"
    | "OFFLINE_SYNC_RECORD_OUTSIDE_PERMIT"
    | "OFFLINE_SYNC_CLOCK_INVALID"
    | "OFFLINE_SYNC_PAYLOAD_INVALID"
    | "OFFLINE_SYNC_RISK_LIMIT_REACHED"
    | "OFFLINE_SYNC_BACKEND_NOT_WRITABLE") {
    super(code);
    this.name = "OfflineSyncOperationError";
  }
}

class OfflineRecordConflictError extends Error {
  constructor(
    readonly conflictType: OfflineSyncConflictType,
    readonly errorCode: string,
  ) {
    super(errorCode);
    this.name = "OfflineRecordConflictError";
  }
}

function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeMetadata(value: Record<string, string | number | boolean | null>) {
  return JSON.stringify(value);
}

function localStateToOrderStatus(state: OfflineOrderState): OrderStatus {
  return ({
    LOCAL_NEW: "CONFIRMED",
    LOCAL_CONFIRMED: "CONFIRMED",
    LOCAL_PREPARING: "PREPARING",
    LOCAL_READY: "READY",
    LOCAL_COMPLETED: "COMPLETED",
    LOCAL_CANCELLED: "CANCELLED",
  } as const)[state];
}

function localStateToItemStatus(state: OfflineOrderState): OrderItemStatus {
  return ({
    LOCAL_NEW: "PENDING",
    LOCAL_CONFIRMED: "PENDING",
    LOCAL_PREPARING: "PREPARING",
    LOCAL_READY: "READY",
    LOCAL_COMPLETED: "SERVED",
    LOCAL_CANCELLED: "PENDING",
  } as const)[state];
}

function offlinePaymentMethodForKind(kind: "CASH" | "LINE_PAY" | "JKO_PAY" | "CUSTOM") {
  return ({
    CASH: "CASH",
    LINE_PAY: "MANUAL_LINE_PAY",
    JKO_PAY: "MANUAL_JKOPAY",
    CUSTOM: "OTHER_MANUAL",
  } as const)[kind];
}

function paymentMethodForOfflineMethod(method: NonNullable<OfflineOrder["paymentMethod"]>) {
  return method === "CASH"
    ? "CASH" as const
    : method === "OTHER_MANUAL"
      ? "OTHER" as const
      : "MANUAL_TRANSFER" as const;
}

function prepareSnapshotItems(
  order: OfflineOrder,
  snapshotCatalog: z.infer<typeof snapshotCatalogSchema>,
) {
  const productMap = new Map(snapshotCatalog.products.map((product) => [product.id, product]));
  if (
    order.currency !== snapshotCatalog.stall.currency
    || orderItemsExceedLimits(order.itemsSnapshot, order.note, snapshotCatalog.limits)
  ) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_PAYLOAD_INVALID");
  }

  const items = order.itemsSnapshot.map((item) => {
    const product = productMap.get(item.productId);
    if (
      !product
      || !product.isActive
      || !product.isEnabled
      || product.isSoldOut
      || item.quantity > snapshotCatalog.limits.maxItemQuantity
      || item.note.length > snapshotCatalog.limits.maxNoteLength
      || item.name !== product.name
      || item.baseUnitPrice !== product.price
    ) {
      throw new OfflineSyncOperationError("OFFLINE_SYNC_PAYLOAD_INVALID");
    }
    const selectedIds = new Set(item.noteOptions.map((option) => option.noteOptionId));
    if (selectedIds.size !== item.noteOptions.length) {
      throw new OfflineSyncOperationError("OFFLINE_SYNC_PAYLOAD_INVALID");
    }
    const expectedOptions = product.noteGroups.flatMap((group, groupIndex) => {
      if (!group.isActive) return [];
      const options = group.options.filter((option) => option.isActive && selectedIds.has(option.id));
      if (
        options.length < group.minSelections
        || (group.maxSelections !== null && options.length > group.maxSelections)
        || (group.selectionMode === "SINGLE" && options.length > 1)
        || (group.isRequired && options.length === 0)
      ) {
        throw new OfflineSyncOperationError("OFFLINE_SYNC_PAYLOAD_INVALID");
      }
      return options.map((option) => ({
        noteGroupId: group.id,
        noteOptionId: option.id,
        groupName: group.name,
        optionName: option.name,
        priceDelta: option.priceDelta,
        sortOrder: groupIndex * 1_000 + option.sortOrder,
      }));
    });
    const expectedIds = new Set(expectedOptions.map((option) => option.noteOptionId));
    if (
      expectedIds.size !== selectedIds.size
      || [...selectedIds].some((id) => !expectedIds.has(id))
      || expectedOptions.some((expected) => {
        const supplied = item.noteOptions.find(
          (option) => option.noteOptionId === expected.noteOptionId,
        );
        return !supplied
          || supplied.noteGroupId !== expected.noteGroupId
          || supplied.groupName !== expected.groupName
          || supplied.optionName !== expected.optionName
          || supplied.priceDelta !== expected.priceDelta
          || supplied.sortOrder !== expected.sortOrder;
      })
    ) {
      throw new OfflineSyncOperationError("OFFLINE_SYNC_PAYLOAD_INVALID");
    }
    const expectedUnitPrice = Math.max(
      0,
      product.price + expectedOptions.reduce((sum, option) => sum + option.priceDelta, 0),
    );
    if (item.unitPrice !== expectedUnitPrice) {
      throw new OfflineSyncOperationError("OFFLINE_SYNC_PAYLOAD_INVALID");
    }
    return { ...item, expectedOptions };
  });

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  if (
    subtotal !== order.subtotal
    || order.discountAmount !== 0
    || order.total !== subtotal
  ) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_PAYLOAD_INVALID");
  }
  return items;
}

function adjustedDeviceTime(timestamp: string, clockOffsetMs: number) {
  return new Date(Date.parse(timestamp) + clockOffsetMs);
}

function assertRecordScope(
  context: SharedSyncContext,
  input: {
    organizationId: string;
    stallId: string;
    deviceId: string;
    promotionEpoch: string;
    protocolVersion: string;
    occurredAt: string;
  },
) {
  if (
    input.organizationId !== context.organizationId
    || input.stallId !== context.stallId
    || input.deviceId !== context.device.id
  ) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_SCOPE_INVALID");
  }
  if (input.protocolVersion !== context.permit.appProtocolVersion) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_PROTOCOL_INVALID");
  }
  const clockOffsetMs = Date.now() - context.clientSentAt.getTime();
  if (Math.abs(clockOffsetMs) > CLOCK_SKEW_MAXIMUM_MS) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_CLOCK_INVALID");
  }
  const occurredAt = adjustedDeviceTime(input.occurredAt, clockOffsetMs);
  if (
    occurredAt < context.permitRecord.issuedAt
    || occurredAt > context.permitRecord.expiresAt
  ) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_RECORD_OUTSIDE_PERMIT");
  }
  return { clockOffsetMs, occurredAt, epochChanged: input.promotionEpoch !== context.runtime.promotionEpoch.toString() };
}

async function resolveSharedSyncContext(input: {
  organizationId: string;
  stallId: string;
  installationId: string;
  permitToken: string;
  clientSentAt: string;
  actor: SyncActor;
}): Promise<SharedSyncContext> {
  const signedPermit = verifyOfflinePermit(
    input.permitToken,
    requireOfflinePermitSigningSecret(),
    new Date(),
    { allowExpired: true },
  );
  if (!signedPermit) throw new OfflineSyncOperationError("OFFLINE_SYNC_PERMIT_INVALID");
  if (
    signedPermit.organizationId !== input.organizationId
    || signedPermit.stallId !== input.stallId
    || signedPermit.profileId !== input.actor.profileId
  ) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_SCOPE_INVALID");
  }

  const [permitRecord, device, runtime] = await Promise.all([
    prisma.offlinePermit.findUnique({
      where: { id: signedPermit.permitId },
      select: {
        id: true,
        organizationId: true,
        stallId: true,
        deviceId: true,
        profileId: true,
        menuSnapshotVersion: true,
        tokenHash: true,
        rolesJson: true,
        allowedActionsJson: true,
        promotionEpoch: true,
        status: true,
        issuedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
    prisma.clientDevice.findUnique({
      where: {
        organizationId_installationId: {
          organizationId: input.organizationId,
          installationId: input.installationId,
        },
      },
      select: {
        id: true,
        organizationId: true,
        stallId: true,
        profileId: true,
        status: true,
        offlineEnabled: true,
        offlineRole: true,
        revokedAt: true,
        updatedAt: true,
      },
    }),
    prisma.backendRuntimeState.findFirst({
      where: {
        isCurrent: true,
        backendRole: "ACTIVE_WRITER",
        writesEnabled: true,
      },
      select: { promotionEpoch: true },
    }),
  ]);
  if (!runtime) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_BACKEND_NOT_WRITABLE");
  }
  if (
    !permitRecord
    || !safeEqual(permitRecord.tokenHash, hashToken(input.permitToken))
    || permitRecord.organizationId !== input.organizationId
    || permitRecord.stallId !== input.stallId
    || permitRecord.deviceId !== signedPermit.deviceId
    || permitRecord.profileId !== signedPermit.profileId
    || permitRecord.menuSnapshotVersion !== signedPermit.menuSnapshotVersion
    || JSON.stringify(permitRecord.rolesJson) !== JSON.stringify(signedPermit.roles)
    || JSON.stringify(permitRecord.allowedActionsJson)
      !== JSON.stringify(signedPermit.allowedOfflineActions)
    || permitRecord.promotionEpoch.toString() !== signedPermit.promotionEpoch
    || permitRecord.issuedAt.toISOString() !== signedPermit.issuedAt
    || permitRecord.expiresAt.toISOString() !== signedPermit.expiresAt
  ) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_PERMIT_INVALID");
  }
  if (
    !device
    || device.id !== signedPermit.deviceId
    || device.organizationId !== input.organizationId
    || device.stallId !== input.stallId
    || device.profileId !== input.actor.profileId
    || device.offlineRole !== "OFFLINE_LEADER"
    || !device.offlineEnabled
  ) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_DEVICE_INVALID");
  }
  if (!signedPermit.allowedOfflineActions.includes("CREATE_OFFLINE_ORDER")) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_PERMIT_INVALID");
  }

  return {
    organizationId: input.organizationId,
    stallId: input.stallId,
    actor: input.actor,
    clientSentAt: new Date(input.clientSentAt),
    permit: signedPermit,
    permitRecord,
    device,
    runtime,
  };
}

async function findOrCreateConflict(
  transaction: Prisma.TransactionClient,
  input: {
    context: SharedSyncContext;
    localEntityType: "ORDER" | "CASH_EVENT" | "PRINT_JOB";
    localEntityId: string;
    offlineOrderId?: string;
    orderId?: string;
    receiptId?: string;
    conflictType: OfflineSyncConflictType;
    details?: Prisma.InputJsonObject;
  },
) {
  const existing = await transaction.offlineSyncConflict.findFirst({
    where: {
      deviceId: input.context.device.id,
      localEntityType: input.localEntityType,
      localEntityId: input.localEntityId,
      conflictType: input.conflictType,
    },
  });
  if (existing) return existing;
  return transaction.offlineSyncConflict.create({
    data: {
      organizationId: input.context.organizationId,
      stallId: input.context.stallId,
      deviceId: input.context.device.id,
      receiptId: input.receiptId,
      orderId: input.orderId,
      localEntityType: input.localEntityType,
      localEntityId: input.localEntityId,
      offlineOrderId: input.offlineOrderId,
      conflictType: input.conflictType,
      detailsJson: input.details ?? {},
    },
  });
}

function responseConflict(conflict: { id: string; conflictType: string; resolutionStatus: string }) {
  return {
    conflictId: conflict.id,
    type: conflict.conflictType as OfflineSyncConflictType,
    resolutionStatus: conflict.resolutionStatus,
  };
}

async function rejectRecordWithConflict(
  context: SharedSyncContext,
  record: OfflineSyncRecord,
  conflictType: OfflineSyncConflictType,
  errorCode: string,
  serverReceivedAt: Date,
): Promise<OfflineSyncReceipt> {
  const localEntityId = record.recordType === "ORDER"
    ? record.order.offlineOrderId
    : record.event.cashEventId;
  const localEntityType = record.recordType === "ORDER" ? "ORDER" as const : "CASH_EVENT" as const;
  const idempotencyKey = record.recordType === "ORDER"
    ? record.order.idempotencyKey
    : record.event.idempotencyKey;
  const conflict = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`offline-reject:${context.device.id}:${localEntityId}`}, 0)
      )::text
    `;
    const created = await findOrCreateConflict(transaction, {
      context,
      localEntityType,
      localEntityId,
      offlineOrderId: record.recordType === "ORDER" ? record.order.offlineOrderId : undefined,
      conflictType,
      details: { errorCode },
    });
    const existingInbox = await transaction.domainInboxMessage.findUnique({
      where: {
        source_messageKey: {
          source: record.recordType === "ORDER" ? "OFFLINE_ORDER_SYNC" : "OFFLINE_CASH_SYNC",
          messageKey: idempotencyKey,
        },
      },
    });
    if (!existingInbox) {
      await transaction.domainInboxMessage.create({
        data: {
          organizationId: context.organizationId,
          stallId: context.stallId,
          deviceId: context.device.id,
          source: record.recordType === "ORDER" ? "OFFLINE_ORDER_SYNC" : "OFFLINE_CASH_SYNC",
          messageKey: idempotencyKey,
          payloadHash: payloadHash(record),
          status: "REJECTED",
          resultJson: { outcome: "REJECTED", errorCode },
          processedAt: serverReceivedAt,
        },
      });
    }
    await transaction.auditLog.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        actorProfileId: context.actor.profileId,
        action: "OFFLINE_SYNC_RECORD_REJECTED",
        entityType: localEntityType,
        entityId: localEntityId,
        outcome: "DENIED",
        requestId: context.actor.requestId,
        ipHash: context.actor.ipHash,
        metadata: safeMetadata({
          deviceId: context.device.id,
          conflictType,
          errorCode,
        }),
      },
    });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return {
    queueId: record.queueId,
    localEntityId,
    recordType: record.recordType,
    outcome: "REJECTED",
    canonicalOrderId: null,
    canonicalOrderNumber: null,
    serverReceivedAt: serverReceivedAt.toISOString(),
    conflicts: [responseConflict(conflict)],
    errorCode,
  };
}

async function currentProductConflicts(
  transaction: Prisma.TransactionClient,
  context: SharedSyncContext,
  preparedItems: Array<ReturnType<typeof prepareSnapshotItems>[number]>,
  now: Date,
) {
  const assignments = await transaction.stallProduct.findMany({
    where: {
      organizationId: context.organizationId,
      stallId: context.stallId,
      productId: { in: preparedItems.map((item) => item.productId) },
    },
    select: {
      productId: true,
      priceOverride: true,
      isEnabled: true,
      isSoldOut: true,
      availableFrom: true,
      availableUntil: true,
      product: {
        select: {
          isActive: true,
          defaultPrice: true,
          category: { select: { isActive: true } },
          noteGroupAssignments: {
            where: { isActive: true, noteGroup: { isActive: true } },
            select: {
              noteGroup: {
                select: {
                  id: true,
                  options: {
                    where: { isActive: true },
                    select: { id: true, priceDelta: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const byProduct = new Map(assignments.map((assignment) => [assignment.productId, assignment]));
  const conflicts = new Set<OfflineSyncConflictType>();
  const items: PreparedSnapshotItem[] = preparedItems.map((item) => {
    const current = byProduct.get(item.productId);
    if (!current) {
      conflicts.add("PRODUCT_DELETED");
      return {
        ...item,
        canonicalProductId: null,
        canonicalNoteOptions: item.expectedOptions.map((option) => ({
          ...option,
          canonicalNoteGroupId: null,
          canonicalNoteOptionId: null,
        })),
      };
    }
    if (
      !current.isEnabled
      || current.isSoldOut
      || !current.product.isActive
      || !current.product.category.isActive
      || (current.availableFrom && current.availableFrom > now)
      || (current.availableUntil && current.availableUntil <= now)
    ) {
      conflicts.add("PRODUCT_DISABLED");
    }
    const currentOptions = new Map(
      current.product.noteGroupAssignments.flatMap(({ noteGroup }) => (
        noteGroup.options.map((option) => [
          option.id,
          { ...option, noteGroupId: noteGroup.id },
        ] as const)
      )),
    );
    const currentBase = current.priceOverride ?? current.product.defaultPrice;
    const selectedCurrent = item.expectedOptions.map((option) => currentOptions.get(option.noteOptionId));
    if (selectedCurrent.some((option) => !option)) conflicts.add("PRICE_CHANGED");
    const currentUnit = Math.max(
      0,
      currentBase + selectedCurrent.reduce((sum, option) => sum + (option?.priceDelta ?? 0), 0),
    );
    if (currentUnit !== item.unitPrice) conflicts.add("PRICE_CHANGED");
    return {
      ...item,
      canonicalProductId: item.productId,
      canonicalNoteOptions: item.expectedOptions.map((option) => {
        const currentOption = currentOptions.get(option.noteOptionId);
        return {
          ...option,
          canonicalNoteGroupId: currentOption?.noteGroupId ?? null,
          canonicalNoteOptionId: currentOption?.id ?? null,
        };
      }),
    };
  });
  return { items, conflicts };
}

async function importOfflineOrder(
  context: SharedSyncContext,
  record: OfflineOrderSyncRecord,
  serverReceivedAt: Date,
): Promise<OfflineSyncReceipt> {
  const order = offlineOrderSchema.parse(record.order);
  const scope = assertRecordScope(context, {
    organizationId: order.organizationId,
    stallId: order.stallId,
    deviceId: order.deviceId,
    promotionEpoch: order.promotionEpoch,
    protocolVersion: order.protocolVersion,
    occurredAt: order.createdAtDevice,
  });
  if (
    order.menuSnapshotVersion !== context.permit.menuSnapshotVersion
    || !validateOfflineEventChain(record)
  ) {
    throw new OfflineRecordConflictError(
      order.menuSnapshotVersion !== context.permit.menuSnapshotVersion
        ? "UNKNOWN_REFERENCE"
        : "INVALID_STATE_TRANSITION",
      order.menuSnapshotVersion !== context.permit.menuSnapshotVersion
        ? "OFFLINE_MENU_SNAPSHOT_SCOPE_INVALID"
        : "OFFLINE_EVENT_CHAIN_INVALID",
    );
  }
  if (
    record.events.some((event) => (
      adjustedDeviceTime(event.occurredAtDevice, scope.clockOffsetMs) < context.permitRecord.issuedAt
      || adjustedDeviceTime(event.occurredAtDevice, scope.clockOffsetMs) > context.permitRecord.expiresAt
    ))
  ) {
    throw new OfflineRecordConflictError(
      "INVALID_STATE_TRANSITION",
      "OFFLINE_EVENT_OUTSIDE_PERMIT",
    );
  }
  const revocationTime = context.permitRecord.revokedAt ?? context.device.revokedAt;
  if (
    (!ACTIVE_DEVICE_STATUSES.has(context.device.status) || context.permitRecord.status === "REVOKED")
    && (!revocationTime || scope.occurredAt >= revocationTime)
  ) {
    throw new OfflineRecordConflictError("DEVICE_REVOKED", "OFFLINE_DEVICE_REVOKED");
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`offline-order:${order.idempotencyKey}`}, 0)
      )::text
    `;
    const existingInbox = await transaction.domainInboxMessage.findUnique({
      where: {
        source_messageKey: {
          source: "OFFLINE_ORDER_SYNC",
          messageKey: order.idempotencyKey,
        },
      },
    });
    if (existingInbox && existingInbox.payloadHash !== payloadHash(record)) {
      throw new OfflineRecordConflictError(
        "DUPLICATE_ORDER",
        "OFFLINE_PAYLOAD_REPLAY_MISMATCH",
      );
    }
    const rejectedReplayErrorCode = existingInbox
      ? rejectedInboxReplayErrorCode(existingInbox.status, existingInbox.resultJson)
      : null;
    if (rejectedReplayErrorCode) {
      const conflicts = await transaction.offlineSyncConflict.findMany({
        where: {
          deviceId: context.device.id,
          offlineOrderId: order.offlineOrderId,
        },
      });
      return {
        queueId: record.queueId,
        localEntityId: order.offlineOrderId,
        recordType: "ORDER" as const,
        outcome: "REJECTED" as const,
        canonicalOrderId: null,
        canonicalOrderNumber: null,
        serverReceivedAt: serverReceivedAt.toISOString(),
        conflicts: conflicts.map(responseConflict),
        errorCode: rejectedReplayErrorCode,
      };
    }
    const existingReceipt = await transaction.offlineOrderSyncReceipt.findFirst({
      where: {
        OR: [
          {
            deviceId: context.device.id,
            offlineOrderId: order.offlineOrderId,
          },
          { idempotencyKey: order.idempotencyKey },
        ],
      },
    });
    if (existingReceipt) {
      if (
        existingReceipt.deviceId !== context.device.id
        || existingReceipt.offlineOrderId !== order.offlineOrderId
        || existingReceipt.idempotencyKey !== order.idempotencyKey
      ) {
        throw new OfflineRecordConflictError("DUPLICATE_ORDER", "OFFLINE_IDEMPOTENCY_COLLISION");
      }
      if (!existingInbox || existingInbox.payloadHash !== payloadHash(record)) {
        throw new OfflineRecordConflictError("DUPLICATE_ORDER", "OFFLINE_PAYLOAD_REPLAY_MISMATCH");
      }
      const conflicts = await transaction.offlineSyncConflict.findMany({
        where: {
          deviceId: context.device.id,
          offlineOrderId: order.offlineOrderId,
        },
      });
      return {
        queueId: record.queueId,
        localEntityId: order.offlineOrderId,
        recordType: "ORDER" as const,
        outcome: "DUPLICATE" as const,
        canonicalOrderId: existingReceipt.orderId,
        canonicalOrderNumber: existingReceipt.canonicalOrderNumber,
        serverReceivedAt: serverReceivedAt.toISOString(),
        conflicts: conflicts.map(responseConflict),
      };
    }

    const orphanedOrder = await transaction.order.findFirst({
      where: {
        OR: [
          {
            sourceDeviceId: context.device.id,
            offlineOrderId: order.offlineOrderId,
          },
          {
            stallId: context.stallId,
            idempotencyKey: order.idempotencyKey,
          },
        ],
      },
      select: {
        id: true,
        organizationId: true,
        stallId: true,
        orderNo: true,
        source: true,
        origin: true,
        deviceHash: true,
        sourceDeviceId: true,
        offlineOrderId: true,
        idempotencyKey: true,
      },
    });
    if (orphanedOrder) {
      if (!matchesExistingOrderReplay({
        existing: orphanedOrder,
        organizationId: context.organizationId,
        stallId: context.stallId,
        deviceId: context.device.id,
        actorProfileId: context.actor.profileId,
        offlineOrderId: order.offlineOrderId,
        idempotencyKey: order.idempotencyKey,
      })) {
        throw new OfflineRecordConflictError("DUPLICATE_ORDER", "OFFLINE_IDEMPOTENCY_COLLISION");
      }
      const reconciledReceipt = await transaction.offlineOrderSyncReceipt.create({
        data: {
          organizationId: context.organizationId,
          stallId: context.stallId,
          deviceId: context.device.id,
          offlineOrderId: order.offlineOrderId,
          idempotencyKey: order.idempotencyKey,
          orderId: orphanedOrder.id,
          outcome: "DUPLICATE",
          localDisplayNumber: order.localDisplayNumber,
          canonicalOrderNumber: orphanedOrder.orderNo,
          promotionEpoch: context.runtime.promotionEpoch,
          serverReceivedAt,
          expiresAt: new Date(serverReceivedAt.getTime() + 30 * 24 * 60 * 60_000),
        },
      });
      await transaction.domainInboxMessage.create({
        data: {
          organizationId: context.organizationId,
          stallId: context.stallId,
          deviceId: context.device.id,
          source: "OFFLINE_ORDER_SYNC",
          messageKey: order.idempotencyKey,
          payloadHash: payloadHash(record),
          status: "PROCESSED",
          resultJson: {
            orderId: orphanedOrder.id,
            orderNo: orphanedOrder.orderNo,
            outcome: "DUPLICATE",
          },
          processedAt: serverReceivedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: context.organizationId,
          stallId: context.stallId,
          actorProfileId: context.actor.profileId,
          action: "OFFLINE_ORDER_RECONCILED_TO_ONLINE",
          entityType: "ORDER",
          entityId: orphanedOrder.id,
          outcome: "SUCCESS",
          requestId: context.actor.requestId,
          ipHash: context.actor.ipHash,
          metadata: safeMetadata({
            deviceId: context.device.id,
            offlineOrderId: order.offlineOrderId,
            localDisplayNumber: order.localDisplayNumber,
          }),
        },
      });
      return {
        queueId: record.queueId,
        localEntityId: order.offlineOrderId,
        recordType: "ORDER" as const,
        outcome: "DUPLICATE" as const,
        canonicalOrderId: reconciledReceipt.orderId,
        canonicalOrderNumber: reconciledReceipt.canonicalOrderNumber,
        serverReceivedAt: serverReceivedAt.toISOString(),
        conflicts: [],
      };
    }

    const snapshot = await transaction.menuSnapshot.findFirst({
      where: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        version: order.menuSnapshotVersion,
      },
    });
    if (!snapshot) {
      throw new OfflineRecordConflictError("UNKNOWN_REFERENCE", "OFFLINE_MENU_SNAPSHOT_NOT_FOUND");
    }
    const snapshotCatalogResult = snapshotCatalogSchema.safeParse(snapshot.catalogJson);
    if (!snapshotCatalogResult.success || snapshotCatalogResult.data.stall.id !== context.stallId) {
      throw new OfflineRecordConflictError("UNKNOWN_REFERENCE", "OFFLINE_MENU_SNAPSHOT_INVALID");
    }
    const snapshotItems = prepareSnapshotItems(order, snapshotCatalogResult.data);
    await new EntitlementService(transaction).assertLimitAvailable(
      context.organizationId,
      "ORDERS",
      1,
    );

    const [priorOrderCount, priorOrderTotal, priorManualPaymentTotal] = await Promise.all([
      transaction.order.count({
        where: {
          sourceDeviceId: context.device.id,
          origin: "OFFLINE_POS",
          deviceCreatedAt: {
            gte: context.permitRecord.issuedAt,
            lte: context.permitRecord.expiresAt,
          },
        },
      }),
      transaction.order.aggregate({
        where: {
          sourceDeviceId: context.device.id,
          origin: "OFFLINE_POS",
          deviceCreatedAt: {
            gte: context.permitRecord.issuedAt,
            lte: context.permitRecord.expiresAt,
          },
        },
        _sum: { total: true },
      }),
      transaction.payment.aggregate({
        where: {
          order: {
            sourceDeviceId: context.device.id,
            origin: "OFFLINE_POS",
            deviceCreatedAt: {
              gte: context.permitRecord.issuedAt,
              lte: context.permitRecord.expiresAt,
            },
          },
          offlinePaymentMethod: {
            in: ["MANUAL_LINE_PAY", "MANUAL_JKOPAY", "OTHER_MANUAL"],
          },
        },
        _sum: { amount: true },
      }),
    ]);
    if (
      priorOrderCount + 1 > context.permit.riskLimits.maxPendingOrders
      || (priorOrderTotal._sum.total ?? 0) + order.total > context.permit.riskLimits.maxTotalAmount
      || order.total > context.permit.riskLimits.maxSingleOrderAmount
    ) {
      throw new OfflineRecordConflictError(
        "UNKNOWN_REFERENCE",
        "OFFLINE_SYNC_RISK_LIMIT_REACHED",
      );
    }
    if (
      order.paymentMethod
      && order.paymentMethod !== "CASH"
      && (
        order.total > context.permit.riskLimits.maxManualPaymentAmount
        || (priorManualPaymentTotal._sum.amount ?? 0) + order.total
          > context.permit.riskLimits.maxTotalManualPaymentAmount
        || (
          context.permit.riskLimits.requireCustomerContactAboveAmount > 0
          && order.total >= context.permit.riskLimits.requireCustomerContactAboveAmount
          && !order.customerContact
        )
        || (
          context.permit.riskLimits.managerApprovalThreshold > 0
          && order.total >= context.permit.riskLimits.managerApprovalThreshold
          && !context.permit.roles.some((role) => MANAGER_ROLES.has(role))
        )
      )
    ) {
      throw new OfflineRecordConflictError(
        "PAYMENT_RECONCILIATION_REQUIRED",
        "OFFLINE_MANUAL_PAYMENT_LIMIT_REACHED",
      );
    }

    const { items, conflicts } = await currentProductConflicts(
      transaction,
      context,
      snapshotItems,
      serverReceivedAt,
    );
    if (snapshot.expiresAt < scope.occurredAt) conflicts.add("MENU_VERSION_EXPIRED");
    if (scope.epochChanged) conflicts.add("BACKEND_EPOCH_CHANGED");
    if (Math.abs(scope.clockOffsetMs) > CLOCK_SKEW_WARNING_MS) conflicts.add("CLOCK_SKEW");
    if (
      context.permitRecord.status === "REVOKED"
      || !ACTIVE_DEVICE_STATUSES.has(context.device.status)
    ) {
      conflicts.add("DEVICE_REVOKED");
    }
    const currentRoleSet = new Set(context.actor.roles);
    if (context.permit.roles.some((role) => !currentRoleSet.has(role))) {
      conflicts.add("ROLE_CHANGED");
    }

    let paymentData: Prisma.PaymentUncheckedCreateWithoutOrderInput | undefined;
    if (record.payment) {
      if (!context.permit.allowedOfflineActions.includes("RECORD_CASH_PAYMENT")) {
        throw new OfflineRecordConflictError(
          "PAYMENT_RECONCILIATION_REQUIRED",
          "OFFLINE_PAYMENT_ACTION_NOT_ALLOWED",
        );
      }
      if (
        record.payment.offlineOrderId !== order.offlineOrderId
        || record.payment.amount !== order.total
        || record.payment.method !== order.paymentMethod
        || !record.payment.paymentOptionId
      ) {
        throw new OfflineRecordConflictError(
          "PAYMENT_RECONCILIATION_REQUIRED",
          "OFFLINE_PAYMENT_SCOPE_INVALID",
        );
      }
      const snapshotPaymentOption = snapshotCatalogResult.data.paymentOptions.find(
        (option) => option.id === record.payment?.paymentOptionId,
      );
      if (
        !snapshotPaymentOption
        || offlinePaymentMethodForKind(snapshotPaymentOption.kind) !== record.payment.method
        || snapshotPaymentOption.name !== record.payment.methodLabel
      ) {
        throw new OfflineRecordConflictError(
          "PAYMENT_RECONCILIATION_REQUIRED",
          "OFFLINE_PAYMENT_SNAPSHOT_INVALID",
        );
      }
      const currentPaymentOption = await transaction.paymentOption.findFirst({
        where: {
          id: record.payment.paymentOptionId,
          organizationId: context.organizationId,
          stallId: context.stallId,
          isEnabled: true,
        },
        select: { id: true },
      });
      if (!currentPaymentOption) conflicts.add("UNKNOWN_REFERENCE");

      let paymentStatus = record.payment.method === "CASH"
        ? "PAID" as const
        : "PENDING_RECONCILIATION" as const;
      let cashShiftId: string | null = null;
      if (record.payment.method === "CASH") {
        const cashShift = record.payment.cashShiftId
          ? await transaction.cashShift.findFirst({
              where: {
                id: record.payment.cashShiftId,
                organizationId: context.organizationId,
                stallId: context.stallId,
              },
              select: { id: true, status: true },
            })
          : null;
        if (!cashShift) {
          throw new OfflineRecordConflictError(
            "UNKNOWN_REFERENCE",
            "OFFLINE_CASH_SHIFT_NOT_FOUND",
          );
        }
        cashShiftId = cashShift.id;
        if (cashShift.status !== "OPEN") {
          paymentStatus = "PENDING_RECONCILIATION";
          conflicts.add("SHIFT_ALREADY_CLOSED");
          conflicts.add("PAYMENT_RECONCILIATION_REQUIRED");
        }
      } else {
        conflicts.add("PAYMENT_RECONCILIATION_REQUIRED");
      }
      paymentData = {
        organizationId: context.organizationId,
        stallId: context.stallId,
        paymentOptionId: currentPaymentOption?.id ?? null,
        cashShiftId,
        amount: record.payment.amount,
        method: paymentMethodForOfflineMethod(record.payment.method),
        status: paymentStatus,
        methodLabel: record.payment.methodLabel,
        offlinePaymentMethod: record.payment.method,
        reconciliationStatus: paymentStatus === "PENDING_RECONCILIATION"
          ? "PENDING_RECONCILIATION"
          : null,
        cashReceived: record.payment.cashReceived,
        changeAmount: record.payment.changeAmount,
        recordedById: context.actor.profileId,
        paidAt: paymentStatus === "PAID"
          ? adjustedDeviceTime(record.payment.recordedAtDevice, scope.clockOffsetMs)
          : undefined,
      };
    }

    const preparedPrintJobs: Prisma.PrintJobUncheckedCreateWithoutOrderInput[] = [];
    if (
      record.printJobs.length > 0
      && !context.permit.allowedOfflineActions.includes("QUEUE_PRINT_JOB")
    ) {
      throw new OfflineRecordConflictError(
        "PRINT_STATUS_UNKNOWN",
        "OFFLINE_PRINT_ACTION_NOT_ALLOWED",
      );
    }
    for (const printJob of record.printJobs) {
      let printerId: string | null = null;
      if (printJob.printerId) {
        const printer = await transaction.printer.findFirst({
          where: {
            id: printJob.printerId,
            organizationId: context.organizationId,
            stallId: context.stallId,
            isEnabled: true,
          },
          select: { id: true },
        });
        printerId = printer?.id ?? null;
        if (!printer) conflicts.add("UNKNOWN_REFERENCE");
      }
      const status = printJob.status === "PRINTING" ? "FAILED" : printJob.status;
      if (printJob.status === "PRINTING") conflicts.add("PRINT_STATUS_UNKNOWN");
      preparedPrintJobs.push({
        organizationId: context.organizationId,
        stallId: context.stallId,
        printerId,
        requestedById: context.actor.profileId,
        status,
        copies: 1,
        attemptCount: printJob.attemptCount,
        maxAttempts: 3,
        lastError: printJob.status === "PRINTING" ? "OFFLINE_PRINT_STATUS_UNKNOWN" : null,
        queuedAt: scope.occurredAt,
        printingAt: null,
        printedAt: status === "SUCCEEDED" && printJob.printedAt
          ? adjustedDeviceTime(printJob.printedAt, scope.clockOffsetMs)
          : null,
        offlinePrintJobId: printJob.printJobId,
        templateVersion: printJob.templateVersion,
      });
    }

    const [businessDateRow] = await transaction.$queryRaw<Array<{ business_date: Date }>>`
      select public.stall_business_date(
        ${context.stallId}::uuid,
        ${scope.occurredAt}
      ) as business_date
    `;
    if (!businessDateRow) {
      throw new OfflineRecordConflictError("UNKNOWN_REFERENCE", "OFFLINE_BUSINESS_DATE_INVALID");
    }
    const counter = await transaction.stallOrderCounter.upsert({
      where: {
        stallId_businessDate: {
          stallId: context.stallId,
          businessDate: businessDateRow.business_date,
        },
      },
      create: {
        stallId: context.stallId,
        organizationId: context.organizationId,
        businessDate: businessDateRow.business_date,
        nextValue: 2,
      },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    const orderNo = `${businessDateRow.business_date.toISOString().slice(2, 10).replaceAll("-", "")}-${String(counter.nextValue - 1).padStart(3, "0")}`;
    const orderStatus = localStateToOrderStatus(order.orderStatus);
    const itemStatus = localStateToItemStatus(order.orderStatus);
    const conflictTypes = [...conflicts];
    const canonical = await transaction.order.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        orderNo,
        trackingTokenHash: hashToken(createOpaqueToken()),
        idempotencyKey: order.idempotencyKey,
        source: "OFFLINE_POS",
        origin: "OFFLINE_POS",
        isTest: false,
        customerName: order.customerLabel || "現場顧客",
        customerPhone: order.customerContact || null,
        fulfillmentType: "TAKEOUT",
        note: order.note || null,
        status: orderStatus,
        paymentStatus: paymentData?.status ?? "UNPAID",
        subtotal: order.subtotal,
        discountAmount: 0,
        total: order.total,
        deviceHash: hashToken(`offline-pos:${context.device.id}`),
        pickupCodeHash: null,
        confirmationExpiresAt: scope.occurredAt,
        confirmedAt: orderStatus === "CANCELLED" ? null : scope.occurredAt,
        completedAt: orderStatus === "COMPLETED"
          ? adjustedDeviceTime(order.updatedAtDevice, scope.clockOffsetMs)
          : null,
        cancellationReason: orderStatus === "CANCELLED" ? "OTHER" : null,
        cancellationDetail: orderStatus === "CANCELLED" ? "OFFLINE_LOCAL_CANCELLED" : null,
        cancelledAt: orderStatus === "CANCELLED"
          ? adjustedDeviceTime(order.updatedAtDevice, scope.clockOffsetMs)
          : null,
        cancelledById: orderStatus === "CANCELLED" ? context.actor.profileId : null,
        createdAt: scope.occurredAt,
        paidAt: paymentData?.status === "PAID" ? paymentData.paidAt : null,
        sourceDeviceId: context.device.id,
        offlineOrderId: order.offlineOrderId,
        offlineLocalSequence: order.localSequence,
        menuSnapshotVersion: order.menuSnapshotVersion,
        deviceCreatedAt: scope.occurredAt,
        serverReceivedAt,
        syncedAt: serverReceivedAt,
        offlineSyncStatus: conflictTypes.length > 0 ? "SYNCED_WITH_CONFLICT" : "SYNCED",
        offlineConflictStatus: conflictTypes.length > 0 ? "OPEN" : "NONE",
        deviceClockOffsetMs: BigInt(scope.clockOffsetMs),
        localDisplayNumber: order.localDisplayNumber,
        items: {
          create: items.map((item) => ({
            organizationId: context.organizationId,
            stallId: context.stallId,
            productId: item.canonicalProductId,
            name: item.name,
            baseUnitPrice: item.baseUnitPrice,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            note: item.note || null,
            status: itemStatus,
            preparingAt: ["PREPARING", "READY", "SERVED"].includes(itemStatus)
              ? scope.occurredAt
              : null,
            readyAt: ["READY", "SERVED"].includes(itemStatus)
              ? adjustedDeviceTime(order.updatedAtDevice, scope.clockOffsetMs)
              : null,
            servedAt: itemStatus === "SERVED"
              ? adjustedDeviceTime(order.updatedAtDevice, scope.clockOffsetMs)
              : null,
            noteOptions: {
              create: item.canonicalNoteOptions.map((option) => ({
                organizationId: context.organizationId,
                stallId: context.stallId,
                noteGroupId: option.canonicalNoteGroupId,
                noteOptionId: option.canonicalNoteOptionId,
                groupName: option.groupName,
                optionName: option.optionName,
                priceDelta: option.priceDelta,
                sortOrder: option.sortOrder,
              })),
            },
          })),
        },
        events: {
          create: record.events.map((event) => ({
            organizationId: context.organizationId,
            stallId: context.stallId,
            eventType: `OFFLINE_ORDER_${event.nextState.replace("LOCAL_", "")}`,
            previousStatus: event.previousState
              ? localStateToOrderStatus(event.previousState)
              : null,
            newStatus: localStateToOrderStatus(event.nextState),
            createdBy: context.actor.profileId,
            createdAt: adjustedDeviceTime(event.occurredAtDevice, scope.clockOffsetMs),
          })),
        },
        payment: paymentData ? { create: paymentData } : undefined,
        printJobs: preparedPrintJobs.length > 0 ? { create: preparedPrintJobs } : undefined,
      },
      select: { id: true, orderNo: true },
    });
    const receipt = await transaction.offlineOrderSyncReceipt.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        deviceId: context.device.id,
        offlineOrderId: order.offlineOrderId,
        idempotencyKey: order.idempotencyKey,
        orderId: canonical.id,
        outcome: conflictTypes.length > 0 ? "ACCEPTED_WITH_CONFLICT" : "ACCEPTED",
        localDisplayNumber: order.localDisplayNumber,
        canonicalOrderNumber: canonical.orderNo,
        promotionEpoch: context.runtime.promotionEpoch,
        serverReceivedAt,
        expiresAt: new Date(serverReceivedAt.getTime() + 30 * 24 * 60 * 60_000),
      },
    });
    const createdConflicts = [];
    for (const conflictType of conflictTypes) {
      createdConflicts.push(await findOrCreateConflict(transaction, {
        context,
        localEntityType: "ORDER",
        localEntityId: order.offlineOrderId,
        offlineOrderId: order.offlineOrderId,
        orderId: canonical.id,
        receiptId: receipt.id,
        conflictType,
        details: {
          menuSnapshotVersion: order.menuSnapshotVersion,
          promotionEpoch: order.promotionEpoch,
          activePromotionEpoch: context.runtime.promotionEpoch.toString(),
        },
      }));
    }
    await transaction.domainInboxMessage.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        deviceId: context.device.id,
        source: "OFFLINE_ORDER_SYNC",
        messageKey: order.idempotencyKey,
        payloadHash: payloadHash(record),
        status: "PROCESSED",
        resultJson: {
          orderId: canonical.id,
          orderNo: canonical.orderNo,
          outcome: receipt.outcome,
        },
        processedAt: serverReceivedAt,
      },
    });
    await transaction.domainOutboxEvent.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        aggregateType: "ORDER",
        aggregateId: canonical.id,
        eventType: "OFFLINE_ORDER_IMPORTED",
        dedupeKey: `offline-order:${context.device.id}:${order.offlineOrderId}`,
        payload: {
          orderId: canonical.id,
          origin: "OFFLINE_POS",
          status: orderStatus,
          hasConflict: conflictTypes.length > 0,
        },
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        actorProfileId: context.actor.profileId,
        action: "OFFLINE_ORDER_IMPORTED",
        entityType: "ORDER",
        entityId: canonical.id,
        outcome: "SUCCESS",
        requestId: context.actor.requestId,
        ipHash: context.actor.ipHash,
        metadata: safeMetadata({
          deviceId: context.device.id,
          offlineOrderId: order.offlineOrderId,
          localDisplayNumber: order.localDisplayNumber,
          conflictCount: conflictTypes.length,
        }),
      },
    });
    await transaction.$queryRaw`
      select public.refresh_stall_capacity(
        ${context.stallId}::uuid,
        true,
        'OFFLINE_ORDER_IMPORTED'
      )
    `;
    return {
      queueId: record.queueId,
      localEntityId: order.offlineOrderId,
      recordType: "ORDER" as const,
      outcome: receipt.outcome as "ACCEPTED" | "ACCEPTED_WITH_CONFLICT",
      canonicalOrderId: canonical.id,
      canonicalOrderNumber: canonical.orderNo,
      serverReceivedAt: serverReceivedAt.toISOString(),
      conflicts: createdConflicts.map(responseConflict),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function importOfflineCashEvent(
  context: SharedSyncContext,
  record: Extract<OfflineSyncRecord, { recordType: "CASH_EVENT" }>,
  serverReceivedAt: Date,
): Promise<OfflineSyncReceipt> {
  const event = offlineCashEventSchema.parse(record.event);
  if (!context.permit.allowedOfflineActions.includes("RECORD_CASH_PAYMENT")) {
    throw new OfflineRecordConflictError(
      "PAYMENT_RECONCILIATION_REQUIRED",
      "OFFLINE_CASH_ACTION_NOT_ALLOWED",
    );
  }
  const scope = assertRecordScope(context, {
    organizationId: event.organizationId,
    stallId: event.stallId,
    deviceId: event.deviceId,
    promotionEpoch: event.promotionEpoch,
    protocolVersion: event.protocolVersion,
    occurredAt: event.occurredAtDevice,
  });
  const revocationTime = context.permitRecord.revokedAt ?? context.device.revokedAt;
  if (
    (!ACTIVE_DEVICE_STATUSES.has(context.device.status) || context.permitRecord.status === "REVOKED")
    && (!revocationTime || scope.occurredAt >= revocationTime)
  ) {
    throw new OfflineRecordConflictError("DEVICE_REVOKED", "OFFLINE_DEVICE_REVOKED");
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`offline-cash:${event.idempotencyKey}`}, 0)
      )::text
    `;
    const source = "OFFLINE_CASH_SYNC";
    const existingInbox = await transaction.domainInboxMessage.findUnique({
      where: {
        source_messageKey: {
          source,
          messageKey: event.idempotencyKey,
        },
      },
    });
    if (existingInbox) {
      if (existingInbox.payloadHash !== payloadHash(record)) {
        throw new OfflineRecordConflictError(
          "DUPLICATE_CASH_MOVEMENT",
          "OFFLINE_CASH_IDEMPOTENCY_COLLISION",
        );
      }
      const conflicts = await transaction.offlineSyncConflict.findMany({
        where: {
          deviceId: context.device.id,
          localEntityType: "CASH_EVENT",
          localEntityId: event.cashEventId,
        },
      });
      const rejectedReplayErrorCode = rejectedInboxReplayErrorCode(
        existingInbox.status,
        existingInbox.resultJson,
      );
      return {
        queueId: record.queueId,
        localEntityId: event.cashEventId,
        recordType: "CASH_EVENT" as const,
        outcome: rejectedReplayErrorCode ? "REJECTED" as const : "DUPLICATE" as const,
        canonicalOrderId: null,
        canonicalOrderNumber: null,
        serverReceivedAt: serverReceivedAt.toISOString(),
        conflicts: conflicts.map(responseConflict),
        ...(rejectedReplayErrorCode ? { errorCode: rejectedReplayErrorCode } : {}),
      };
    }

    const shift = await transaction.cashShift.findFirst({
      where: {
        id: event.cashShiftId,
        organizationId: context.organizationId,
        stallId: context.stallId,
      },
    });
    if (!shift) {
      throw new OfflineRecordConflictError(
        "UNKNOWN_REFERENCE",
        "OFFLINE_CASH_SHIFT_NOT_FOUND",
      );
    }
    if (shift.status !== "OPEN") {
      throw new OfflineRecordConflictError(
        "SHIFT_ALREADY_CLOSED",
        "OFFLINE_CASH_SHIFT_ALREADY_CLOSED",
      );
    }

    const conflictTypes = new Set<OfflineSyncConflictType>();
    if (scope.epochChanged) conflictTypes.add("BACKEND_EPOCH_CHANGED");
    if (Math.abs(scope.clockOffsetMs) > CLOCK_SKEW_WARNING_MS) conflictTypes.add("CLOCK_SKEW");
    let resultId = shift.id;
    if (event.eventType === "CASH_IN" || event.eventType === "CASH_OUT") {
      const duplicateMovement = await transaction.cashMovement.findFirst({
        where: {
          cashShiftId: shift.id,
          referenceType: "OFFLINE_CASH_EVENT",
          referenceId: event.cashEventId,
        },
        select: { id: true },
      });
      if (duplicateMovement) {
        conflictTypes.add("DUPLICATE_CASH_MOVEMENT");
        resultId = duplicateMovement.id;
      } else {
        const movement = await transaction.cashMovement.create({
          data: {
            organizationId: context.organizationId,
            stallId: context.stallId,
            cashShiftId: shift.id,
            type: event.eventType,
            amount: event.amount,
            reason: event.reason,
            referenceType: "OFFLINE_CASH_EVENT",
            referenceId: event.cashEventId,
            recordedById: context.actor.profileId,
            createdAt: scope.occurredAt,
          },
        });
        resultId = movement.id;
      }
    } else {
      const totals = await getCashShiftRuntimeTotals(transaction, shift);
      const countedAmount = event.countedAmount ?? 0;
      const varianceAmount = countedAmount - totals.expectedAmount;
      const changed = await transaction.cashShift.updateMany({
        where: { id: shift.id, status: "OPEN" },
        data: {
          status: "CLOSING",
          systemExpectedAmount: totals.expectedAmount,
          countedAmount,
          varianceAmount,
          note: event.reason,
          closedById: context.actor.profileId,
          closedAt: scope.occurredAt,
        },
      });
      if (changed.count !== 1) {
        throw new OfflineRecordConflictError(
          "SHIFT_ALREADY_CLOSED",
          "OFFLINE_CASH_SHIFT_ALREADY_CLOSED",
        );
      }
      if (varianceAmount !== 0) conflictTypes.add("CASH_TOTAL_MISMATCH");
    }

    const createdConflicts = [];
    for (const conflictType of conflictTypes) {
      createdConflicts.push(await findOrCreateConflict(transaction, {
        context,
        localEntityType: "CASH_EVENT",
        localEntityId: event.cashEventId,
        conflictType,
        details: {
          cashShiftId: event.cashShiftId,
          eventType: event.eventType,
        },
      }));
    }
    const outcome = conflictTypes.size > 0 ? "ACCEPTED_WITH_CONFLICT" : "ACCEPTED";
    await transaction.domainInboxMessage.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        deviceId: context.device.id,
        source,
        messageKey: event.idempotencyKey,
        payloadHash: payloadHash(record),
        status: "PROCESSED",
        resultJson: { outcome, resultId, eventType: event.eventType },
        processedAt: serverReceivedAt,
      },
    });
    await transaction.domainOutboxEvent.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        aggregateType: "CASH_SHIFT",
        aggregateId: shift.id,
        eventType: "OFFLINE_CASH_EVENT_IMPORTED",
        dedupeKey: `offline-cash:${context.device.id}:${event.cashEventId}`,
        payload: {
          cashShiftId: shift.id,
          eventType: event.eventType,
          hasConflict: conflictTypes.size > 0,
        },
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: context.organizationId,
        stallId: context.stallId,
        actorProfileId: context.actor.profileId,
        action: "OFFLINE_CASH_EVENT_IMPORTED",
        entityType: "CASH_SHIFT",
        entityId: shift.id,
        outcome: "SUCCESS",
        requestId: context.actor.requestId,
        ipHash: context.actor.ipHash,
        metadata: safeMetadata({
          deviceId: context.device.id,
          cashEventId: event.cashEventId,
          eventType: event.eventType,
          conflictCount: conflictTypes.size,
        }),
      },
    });
    return {
      queueId: record.queueId,
      localEntityId: event.cashEventId,
      recordType: "CASH_EVENT" as const,
      outcome,
      canonicalOrderId: null,
      canonicalOrderNumber: null,
      serverReceivedAt: serverReceivedAt.toISOString(),
      conflicts: createdConflicts.map(responseConflict),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function conflictForError(error: OfflineSyncOperationError) {
  if (error.code === "OFFLINE_SYNC_RECORD_OUTSIDE_PERMIT") {
    return "INVALID_STATE_TRANSITION" as const;
  }
  if (error.code === "OFFLINE_SYNC_CLOCK_INVALID") return "CLOCK_SKEW" as const;
  if (error.code === "OFFLINE_SYNC_RISK_LIMIT_REACHED") {
    return "PAYMENT_RECONCILIATION_REQUIRED" as const;
  }
  return "UNKNOWN_REFERENCE" as const;
}

export async function importOfflineSyncBatch(input: {
  organizationId: string;
  stallId: string;
  installationId: string;
  permitToken: string;
  clientSentAt: string;
  records: OfflineSyncRecord[];
  actor: SyncActor;
}) {
  const context = await resolveSharedSyncContext(input);
  const receipts: OfflineSyncReceipt[] = [];
  for (const record of input.records) {
    const serverReceivedAt = new Date();
    try {
      receipts.push(record.recordType === "ORDER"
        ? await importOfflineOrder(context, record, serverReceivedAt)
        : await importOfflineCashEvent(context, record, serverReceivedAt));
    } catch (error) {
      if (error instanceof OfflineRecordConflictError) {
        receipts.push(await rejectRecordWithConflict(
          context,
          record,
          error.conflictType,
          error.errorCode,
          serverReceivedAt,
        ));
        continue;
      }
      if (error instanceof OfflineSyncOperationError) {
        receipts.push(await rejectRecordWithConflict(
          context,
          record,
          conflictForError(error),
          error.code,
          serverReceivedAt,
        ));
        continue;
      }
      throw error;
    }
  }
  await prisma.clientDevice.update({
    where: { id: context.device.id },
    data: { lastSyncAt: new Date(), lastOnlineAt: new Date() },
  });
  return {
    receipts,
    serverTime: new Date().toISOString(),
    promotionEpoch: context.runtime.promotionEpoch.toString(),
  };
}

export async function getOfflineSyncStatus(input: {
  organizationId: string;
  stallId: string;
  installationId: string;
  profileId: string;
}) {
  const device = await prisma.clientDevice.findUnique({
    where: {
      organizationId_installationId: {
        organizationId: input.organizationId,
        installationId: input.installationId,
      },
    },
    select: {
      id: true,
      profileId: true,
      status: true,
      offlineRole: true,
      offlineEnabled: true,
      lastSyncAt: true,
      permitExpiresAt: true,
    },
  });
  if (!device || device.profileId !== input.profileId) {
    throw new OfflineSyncOperationError("OFFLINE_SYNC_DEVICE_INVALID");
  }
  const [receiptCount, openConflicts, latestReceipt, runtime] = await Promise.all([
    prisma.offlineOrderSyncReceipt.count({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        deviceId: device.id,
      },
    }),
    prisma.offlineSyncConflict.count({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        deviceId: device.id,
        resolutionStatus: "OPEN",
      },
    }),
    prisma.offlineOrderSyncReceipt.findFirst({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        deviceId: device.id,
      },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
    prisma.backendRuntimeState.findFirst({
      where: { isCurrent: true },
      select: {
        backendCode: true,
        backendRole: true,
        writesEnabled: true,
        promotionEpoch: true,
      },
    }),
  ]);
  return {
    device: {
      id: device.id,
      status: device.status,
      offlineRole: device.offlineRole,
      offlineEnabled: device.offlineEnabled,
      lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
      permitExpiresAt: device.permitExpiresAt?.toISOString() ?? null,
    },
    receiptCount,
    openConflictCount: openConflicts,
    latestReceiptAt: latestReceipt?.syncedAt.toISOString() ?? null,
    backend: runtime ? {
      code: runtime.backendCode,
      role: runtime.backendRole,
      writesEnabled: runtime.writesEnabled,
      promotionEpoch: runtime.promotionEpoch.toString(),
    } : null,
  };
}
