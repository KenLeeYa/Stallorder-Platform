import "server-only";

import { Prisma } from "@prisma/client";
import {
  capacityCapabilities,
  normalizeCapacityPauseSource,
  parseCapacitySnapshot,
  type CapacityManagerData,
  type CapacityMerchantCommand,
  type CapacitySnapshot,
  type CapacityStaffCommand,
  type StaffCapacityData,
} from "@/lib/capacity-contract";
import { prisma } from "@/lib/prisma";
import { EntitlementError, entitlementService } from "@/server/billing/entitlement-service";

export class CapacityOperationError extends Error {
  constructor(public readonly code:
    | "STALL_NOT_FOUND"
    | "STALL_NOT_OPEN"
    | "PRODUCT_NOT_AVAILABLE"
    | "RULE_NOT_FOUND"
    | "AUTOMATIC_CONTROL_REQUIRED"
    | "PRODUCT_RULES_REQUIRED"
    | "PRODUCT_RULE_LIMIT_REACHED") {
    super(code);
  }
}

type CapacityItem = { productId: string; quantity: number };

export async function calculateCapacitySnapshot(
  stallId: string,
  items: readonly CapacityItem[] = [],
) {
  const payload = JSON.stringify(items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
  })));
  const rows = await prisma.$queryRaw<Array<{ snapshot: Prisma.JsonValue }>>(Prisma.sql`
    select public.calculate_stall_capacity(
      ${stallId}::uuid,
      ${payload}::jsonb
    ) as snapshot
  `);
  return parseCapacitySnapshot(rows[0]?.snapshot);
}

export async function refreshCapacitySnapshot(
  stallId: string,
  applyAutomation: boolean,
  reason: string,
) {
  const rows = await prisma.$queryRaw<Array<{ snapshot: Prisma.JsonValue }>>(Prisma.sql`
    select public.refresh_stall_capacity(
      ${stallId}::uuid,
      ${applyAutomation},
      ${reason}
    ) as snapshot
  `);
  return parseCapacitySnapshot(rows[0]?.snapshot);
}

export async function getCapacityManagerData(
  organizationId: string,
  stallId: string,
): Promise<CapacityManagerData> {
  const [settings, rules, products, events, snapshot, capabilities] = await Promise.all([
    prisma.stallCapacitySettings.findFirst({
      where: { organizationId, stallId },
    }),
    prisma.productCapacityRule.findMany({
      where: { organizationId, stallId },
      orderBy: [{ product: { sortOrder: "asc" } }, { createdAt: "asc" }],
      include: { product: { select: { name: true } } },
    }),
    prisma.stallProduct.findMany({
      where: {
        organizationId,
        stallId,
        isEnabled: true,
        product: { isActive: true },
      },
      orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
      select: { product: { select: { id: true, name: true } } },
    }),
    prisma.capacityEvent.findMany({
      where: { organizationId, stallId },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    calculateCapacitySnapshot(stallId),
    getCapacityEntitlementCapabilities(organizationId),
  ]);
  if (!settings) throw new CapacityOperationError("STALL_NOT_FOUND");

  return {
    settings: serializeSettings(settings),
    snapshot,
    capabilities,
    products: products.map(({ product }) => product),
    rules: rules.map((rule) => ({
      id: rule.id,
      productId: rule.productId,
      productName: rule.product.name,
      capacityWeight: Number(rule.capacityWeight),
      prepMinutes: rule.prepMinutes,
      maxQuantityPerWindow: rule.maxQuantityPerWindow,
      isActive: rule.isActive,
    })),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      orderCount: event.orderCount,
      itemCount: event.itemCount,
      weightedLoad: Number(event.weightedLoad),
      estimatedWaitMinutes: event.estimatedWaitMinutes,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function getStaffCapacityData(
  organizationId: string,
  stallId: string,
): Promise<StaffCapacityData> {
  const [settings, snapshot, capabilities] = await Promise.all([
    prisma.stallCapacitySettings.findFirst({ where: { organizationId, stallId } }),
    calculateCapacitySnapshot(stallId),
    getCapacityEntitlementCapabilities(organizationId),
  ]);
  if (!settings) throw new CapacityOperationError("STALL_NOT_FOUND");
  return {
    settings: {
      manualWaitMinutes: settings.manualWaitMinutes,
      autoPauseEnabled: settings.autoPauseEnabled,
      autoResumeEnabled: settings.autoResumeEnabled,
      pauseSource: normalizeCapacityPauseSource(settings.pauseSource),
      isActive: settings.isActive,
    },
    snapshot,
    capabilities,
  };
}

export async function applyCapacityMerchantCommand(input: {
  organizationId: string;
  stallId: string;
  command: CapacityMerchantCommand;
}) {
  const capabilities = await getCapacityEntitlementCapabilities(input.organizationId);
  const { command } = input;
  if (command.operation === "UPDATE_SETTINGS") {
    if ((command.autoPauseEnabled || command.autoResumeEnabled) && !capabilities.automaticControl) {
      throw new CapacityOperationError("AUTOMATIC_CONTROL_REQUIRED");
    }
    const current = await prisma.stallCapacitySettings.findFirst({
      where: { organizationId: input.organizationId, stallId: input.stallId },
      select: { id: true, pauseSource: true },
    });
    if (!current) throw new CapacityOperationError("STALL_NOT_FOUND");
    await prisma.stallCapacitySettings.update({
      where: { id: current.id },
      data: {
        windowMinutes: command.windowMinutes,
        maxOrdersPerWindow: command.maxOrdersPerWindow,
        maxItemsPerWindow: command.maxItemsPerWindow,
        warningUtilizationPercent: command.warningUtilizationPercent,
        pauseUtilizationPercent: command.pauseUtilizationPercent,
        defaultPrepMinutes: command.defaultPrepMinutes,
        minimumQuoteMinutes: command.minimumQuoteMinutes,
        maximumQuoteMinutes: command.maximumQuoteMinutes,
        quoteBufferMinutes: command.quoteBufferMinutes,
        acknowledgmentThresholdMinutes: command.acknowledgmentThresholdMinutes,
        autoPauseEnabled: command.autoPauseEnabled,
        autoResumeEnabled: command.autoResumeEnabled,
        isActive: command.isActive,
        ...(!command.autoPauseEnabled && current.pauseSource === "AUTO"
          ? { pauseSource: "MANUAL" }
          : {}),
      },
    });
    return refreshCapacitySnapshot(
      input.stallId,
      capabilities.automaticControl,
      "CAPACITY_SETTINGS_UPDATED",
    );
  }
  if (command.operation === "UPSERT_PRODUCT_RULE") {
    if (!capabilities.productRules) throw new CapacityOperationError("PRODUCT_RULES_REQUIRED");
    const product = await prisma.stallProduct.findFirst({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        productId: command.productId,
        isEnabled: true,
        product: { isActive: true },
      },
      select: { productId: true },
    });
    if (!product) throw new CapacityOperationError("PRODUCT_NOT_AVAILABLE");
    const existing = await prisma.productCapacityRule.findUnique({
      where: { stallId_productId: { stallId: input.stallId, productId: command.productId } },
      select: { id: true },
    });
    if (!existing && capabilities.maxProductRules !== null) {
      const count = await prisma.productCapacityRule.count({
        where: { organizationId: input.organizationId, stallId: input.stallId },
      });
      if (count >= capabilities.maxProductRules) {
        throw new CapacityOperationError("PRODUCT_RULE_LIMIT_REACHED");
      }
    }
    await prisma.productCapacityRule.upsert({
      where: { stallId_productId: { stallId: input.stallId, productId: command.productId } },
      create: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        productId: command.productId,
        capacityWeight: command.capacityWeight,
        prepMinutes: command.prepMinutes,
        maxQuantityPerWindow: command.maxQuantityPerWindow,
        isActive: command.isActive,
      },
      update: {
        capacityWeight: command.capacityWeight,
        prepMinutes: command.prepMinutes,
        maxQuantityPerWindow: command.maxQuantityPerWindow,
        isActive: command.isActive,
      },
    });
    return calculateCapacitySnapshot(input.stallId);
  }
  if (command.operation === "DELETE_PRODUCT_RULE") {
    if (!capabilities.productRules) throw new CapacityOperationError("PRODUCT_RULES_REQUIRED");
    const deleted = await prisma.productCapacityRule.deleteMany({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        productId: command.productId,
      },
    });
    if (deleted.count === 0) throw new CapacityOperationError("RULE_NOT_FOUND");
    return calculateCapacitySnapshot(input.stallId);
  }
  return applyCapacityOperationalCommand({
    organizationId: input.organizationId,
    stallId: input.stallId,
    command,
  });
}

export async function applyCapacityOperationalCommand(input: {
  organizationId: string;
  stallId: string;
  command: CapacityStaffCommand;
}) {
  const capabilities = await getCapacityEntitlementCapabilities(input.organizationId);
  const before = await calculateCapacitySnapshot(input.stallId);
  const { command } = input;

  if (command.operation === "SET_WAIT_OVERRIDE") {
    const updated = await prisma.stallCapacitySettings.updateMany({
      where: { organizationId: input.organizationId, stallId: input.stallId },
      data: { manualWaitMinutes: command.minutes },
    });
    if (updated.count === 0) throw new CapacityOperationError("STALL_NOT_FOUND");
    const snapshot = await calculateCapacitySnapshot(input.stallId);
    await createCapacityEvent(input, snapshot, "WAIT_TIME_CHANGED", command.reason);
    return snapshot;
  }

  if (command.operation === "SET_AUTO_PAUSE") {
    if (command.enabled && !capabilities.automaticControl) {
      throw new CapacityOperationError("AUTOMATIC_CONTROL_REQUIRED");
    }
    const current = await prisma.stallCapacitySettings.findFirst({
      where: { organizationId: input.organizationId, stallId: input.stallId },
      select: { id: true, pauseSource: true },
    });
    if (!current) throw new CapacityOperationError("STALL_NOT_FOUND");
    await prisma.stallCapacitySettings.update({
      where: { id: current.id },
      data: {
        autoPauseEnabled: command.enabled,
        ...(!command.enabled && current.pauseSource === "AUTO"
          ? { pauseSource: "MANUAL" }
          : {}),
      },
    });
    const snapshot = await calculateCapacitySnapshot(input.stallId);
    await createCapacityEvent(input, snapshot, "MANUAL_OVERRIDE", command.reason);
    return snapshot;
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id from public.stalls
      where id = ${input.stallId}::uuid
        and organization_id = ${input.organizationId}::uuid
      for update
    `;
    const stall = await transaction.stall.findFirst({
      where: { id: input.stallId, organizationId: input.organizationId },
      select: {
        id: true,
        isActive: true,
        isSoldOut: true,
        businessStatus: true,
      },
    });
    if (!stall) throw new CapacityOperationError("STALL_NOT_FOUND");
    if (command.operation === "RESUME_ORDERING" && (
      !stall.isActive
      || stall.isSoldOut
      || (stall.businessStatus !== "OPEN" && stall.businessStatus !== "PAUSED")
    )) {
      throw new CapacityOperationError("STALL_NOT_OPEN");
    }

    const settings = await transaction.stallCapacitySettings.findFirst({
      where: { organizationId: input.organizationId, stallId: input.stallId },
      select: { id: true },
    });
    if (!settings) throw new CapacityOperationError("STALL_NOT_FOUND");
    const now = new Date();
    if (command.operation === "PAUSE_ORDERING") {
      await transaction.stallCapacitySettings.update({
        where: { id: settings.id },
        data: { pauseSource: "MANUAL" },
      });
      await transaction.stall.update({
        where: { id: stall.id },
        data: { orderingState: "PAUSED" },
      });
      await transaction.qrCode.updateMany({
        where: { organizationId: input.organizationId, stallId: input.stallId, state: "ACTIVE" },
        data: { state: "PAUSED" },
      });
      await transaction.orderSession.updateMany({
        where: { stallId: input.stallId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
    } else {
      await transaction.stallCapacitySettings.update({
        where: { id: settings.id },
        data: { pauseSource: "NONE" },
      });
      await transaction.stall.update({
        where: { id: stall.id },
        data: { orderingState: "OPEN" },
      });
      await transaction.qrCode.updateMany({
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          state: "PAUSED",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: { state: "ACTIVE" },
      });
    }
    await transaction.capacityEvent.create({
      data: capacityEventValues(
        input.organizationId,
        input.stallId,
        before,
        "MANUAL_OVERRIDE",
        command.reason,
      ),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return calculateCapacitySnapshot(input.stallId);
}

async function getCapacityEntitlementCapabilities(organizationId: string) {
  await entitlementService.assertFeatureEnabled(organizationId, "WAIT_TIME_QUOTE");
  const entitlements = await entitlementService.getEffectiveEntitlements(organizationId);
  const capacity = entitlements.find((entitlement) => (
    entitlement.featureCode === "CAPACITY_CONTROL" && entitlement.isEnabled
  ));
  const configured = capacityCapabilities(capacity?.configuration);
  return {
    waitTimeQuote: true,
    automaticControl: Boolean(capacity) && configured.automaticControl,
    productRules: Boolean(capacity) && configured.productRules,
    maxProductRules: capacity?.limitValue ?? null,
  };
}

async function createCapacityEvent(
  scope: { organizationId: string; stallId: string },
  snapshot: CapacitySnapshot,
  eventType: "MANUAL_OVERRIDE" | "WAIT_TIME_CHANGED",
  reason: string,
) {
  return prisma.capacityEvent.create({
    data: capacityEventValues(
      scope.organizationId,
      scope.stallId,
      snapshot,
      eventType,
      reason,
    ),
  });
}

function capacityEventValues(
  organizationId: string,
  stallId: string,
  snapshot: CapacitySnapshot,
  eventType: "MANUAL_OVERRIDE" | "WAIT_TIME_CHANGED",
  reason: string,
): Prisma.CapacityEventUncheckedCreateInput {
  const now = new Date();
  return {
    organizationId,
    stallId,
    eventType,
    windowStart: snapshot.windowStart ? new Date(snapshot.windowStart) : now,
    windowEnd: snapshot.windowEnd ? new Date(snapshot.windowEnd) : now,
    orderCount: snapshot.orderCount,
    itemCount: snapshot.itemCount,
    weightedLoad: snapshot.weightedLoad,
    estimatedWaitMinutes: snapshot.quoteMaxMinutes,
    reason,
  };
}

function serializeSettings(settings: {
  windowMinutes: number;
  maxOrdersPerWindow: number;
  maxItemsPerWindow: number;
  warningUtilizationPercent: number;
  pauseUtilizationPercent: number;
  defaultPrepMinutes: number;
  minimumQuoteMinutes: number;
  maximumQuoteMinutes: number;
  quoteBufferMinutes: number;
  acknowledgmentThresholdMinutes: number;
  manualWaitMinutes: number | null;
  autoPauseEnabled: boolean;
  autoResumeEnabled: boolean;
  pauseSource: string;
  isActive: boolean;
}) {
  return {
    ...settings,
    pauseSource: normalizeCapacityPauseSource(settings.pauseSource),
  };
}

export function capacityOperationErrorMessage(error: CapacityOperationError) {
  const messages: Record<CapacityOperationError["code"], string> = {
    STALL_NOT_FOUND: "找不到指定攤位或容量設定。",
    STALL_NOT_OPEN: "攤位目前未營業、已售罄或未啟用，無法恢復公開接單。",
    PRODUCT_NOT_AVAILABLE: "此商品不屬於目前攤位或已停止供應。",
    RULE_NOT_FOUND: "找不到指定商品容量規則。",
    AUTOMATIC_CONTROL_REQUIRED: "目前方案未包含自動容量控制。",
    PRODUCT_RULES_REQUIRED: "目前方案未包含商品容量權重規則。",
    PRODUCT_RULE_LIMIT_REACHED: "已達目前方案的商品容量規則上限。",
  };
  return messages[error.code];
}

export function isCapacityEntitlementError(error: unknown): error is EntitlementError {
  return error instanceof EntitlementError;
}
