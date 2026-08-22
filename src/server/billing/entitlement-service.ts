import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isBillingFeatureEnabled } from "@/server/billing/billing-feature-flags";

export const entitlementErrorCodes = [
  "FEATURE_NOT_INCLUDED",
  "PLAN_LIMIT_REACHED",
  "SUBSCRIPTION_NOT_ACTIVE",
  "SUBSCRIPTION_SUSPENDED",
  "TRIAL_EXPIRED",
  "TRIAL_ORDER_LIMIT_REACHED",
  "ADDITIONAL_STALL_APPROVAL_REQUIRED",
  "ORDER_PACKAGE_REQUIRED",
  "UPGRADE_REQUIRED",
] as const;

export type EntitlementErrorCode = (typeof entitlementErrorCodes)[number];
export type BillingMetricCode = "STALLS" | "STAFF" | "PRODUCTS" | "QR_CODES" | "ORDERS";

const entitlementMessages: Record<EntitlementErrorCode, string> = {
  FEATURE_NOT_INCLUDED: "目前方案未包含此功能，請選擇支援此功能的方案。",
  PLAN_LIMIT_REACHED: "已達目前方案的使用上限，請調整既有資料或升級方案。",
  SUBSCRIPTION_NOT_ACTIVE: "訂閱目前不可使用，請至帳務頁面確認訂閱狀態。",
  SUBSCRIPTION_SUSPENDED: "訂閱已停權；仍可查看歷史與帳務資料，但無法新增訂單或資源。",
  TRIAL_EXPIRED: "試用期已結束，請完成方案付款後繼續使用。",
  TRIAL_ORDER_LIMIT_REACHED: "試用訂單額度已用完，請升級為付費方案。",
  ADDITIONAL_STALL_APPROVAL_REQUIRED: "新增攤位前需先取得額外攤位核准。",
  ORDER_PACKAGE_REQUIRED: "已達緊急訂單上限，請由平台管理員指派訂單包。",
  UPGRADE_REQUIRED: "此操作需要升級方案。",
};

const errorStatuses: Record<EntitlementErrorCode, number> = {
  FEATURE_NOT_INCLUDED: 403,
  PLAN_LIMIT_REACHED: 409,
  SUBSCRIPTION_NOT_ACTIVE: 403,
  SUBSCRIPTION_SUSPENDED: 403,
  TRIAL_EXPIRED: 403,
  TRIAL_ORDER_LIMIT_REACHED: 409,
  ADDITIONAL_STALL_APPROVAL_REQUIRED: 409,
  ORDER_PACKAGE_REQUIRED: 409,
  UPGRADE_REQUIRED: 403,
};

export class EntitlementError extends Error {
  readonly status: number;

  constructor(readonly code: EntitlementErrorCode) {
    super(entitlementMessages[code]);
    this.name = "EntitlementError";
    this.status = errorStatuses[code];
  }
}

export type SubscriptionContext = NonNullable<Awaited<ReturnType<EntitlementService["getSubscriptionContext"]>>>;

export type EffectiveEntitlement = {
  featureCode: string;
  isEnabled: boolean;
  limitValue: number | null;
  configuration: Prisma.JsonValue | null;
  source: "PLAN" | "ADD_ON" | "OPEN_BETA";
};

export type BillingPeriodUsage = {
  billingPeriod: Date;
  billableOrders: number;
  activeStalls: number;
  activeStaff: number;
  activeProducts: number;
  activeQrCodes: number;
  csvExports: number;
  orderPackageQuantity: number;
};

type BillingDatabase = Prisma.TransactionClient;
type FeatureSubscriptionContext = {
  status: string;
  trialEndsAt: Date | null;
  planVersion: {
    version: number;
    plan: { code: string };
    entitlements: Array<{
      featureCode: string;
      isEnabled: boolean;
      limitValue: number | null;
      configurationJson: Prisma.JsonValue | null;
    }>;
  };
  items: Array<{ code: string }>;
};

export class EntitlementService {
  constructor(private readonly database: BillingDatabase = prisma as unknown as BillingDatabase) {}

  async getSubscriptionContext(organizationId: string) {
    return this.database.subscription.findUnique({
      where: { organizationId },
      include: {
        plan: true,
        planVersion: { include: { plan: true, entitlements: true } },
        items: {
          where: {
            status: "ACTIVE",
            startsAt: { lte: new Date() },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: "asc" },
        },
        additionalApprovals: {
          where: {
            status: "APPROVED",
            effectiveAt: { lte: new Date() },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        },
      },
    });
  }

  async getEffectivePlanVersion(organizationId: string) {
    const context = await this.requireContext(organizationId);
    return context.planVersion;
  }

  async getEffectiveEntitlements(organizationId: string) {
    const context = await this.requireContext(organizationId);
    return this.getEffectiveEntitlementsForContext(context);
  }

  async getUsableEntitlements(organizationId: string) {
    const openBeta = await this.isOpenBetaFreeAccessEnabled();
    const context = await this.requireContext(organizationId);
    if (openBeta) this.ensureOpenBetaSubscriptionUsable(context);
    else this.ensureSubscriptionUsable(context);
    return this.getEffectiveEntitlementsForContext(context);
  }

  private async getEffectiveEntitlementsForContext(context: SubscriptionContext) {
    const effective = new Map<string, EffectiveEntitlement>();

    for (const entitlement of resolvePlanEntitlements(context.planVersion)) {
      effective.set(entitlement.featureCode, entitlement);
    }

    const itemCodes = context.items
      .filter((item) => item.itemType === "ADD_ON")
      .map((item) => item.code);
    if (itemCodes.length > 0) {
      const addOns = await this.database.addOnCatalog.findMany({
        where: {
          code: { in: itemCodes },
          isActive: true,
          featureCode: { not: null },
          availabilityStatus: { in: ["ENABLED", "MANUAL_APPROVAL_REQUIRED"] },
        },
      });
      for (const addOn of addOns) {
        if (!addOn.featureCode) continue;
        effective.set(addOn.featureCode, {
          featureCode: addOn.featureCode,
          isEnabled: true,
          limitValue: null,
          configuration: null,
          source: "ADD_ON",
        });
      }
    }

    return [...effective.values()].sort((left, right) => left.featureCode.localeCompare(right.featureCode));
  }

  async assertSubscriptionUsable(organizationId: string) {
    if (await this.isOpenBetaFreeAccessEnabled()) {
      const context = await this.requireContext(organizationId);
      this.ensureOpenBetaSubscriptionUsable(context);
      return context;
    }
    const context = await this.requireContext(organizationId);
    this.ensureSubscriptionUsable(context);
    return context;
  }

  async assertFeatureEnabled(organizationId: string, featureCode: string) {
    return this.requireFeatureEntitlement(organizationId, featureCode, true);
  }

  async assertFeatureIncluded(organizationId: string, featureCode: string) {
    return this.requireFeatureEntitlement(organizationId, featureCode, false);
  }

  async assertLimitAvailable(
    organizationId: string,
    metricCode: BillingMetricCode,
    requestedDelta = 1,
  ) {
    if (!Number.isSafeInteger(requestedDelta) || requestedDelta < 0) {
      throw new TypeError("requestedDelta must be a non-negative safe integer");
    }
    if (await this.isOpenBetaFreeAccessEnabled()) {
      const context = await this.assertSubscriptionUsable(organizationId);
      return { context, usage: null, openBeta: true as const };
    }
    const context = await this.assertSubscriptionUsable(organizationId);
    if (!context) throw new EntitlementError("SUBSCRIPTION_NOT_ACTIVE");
    const usage = await this.getBillingPeriodUsage(organizationId, context.billingPeriodStart);
    const version = context.planVersion;

    if (metricCode === "STALLS") {
      const approvedAdditional = context.additionalApprovals.reduce(
        (total, approval) => total + approval.quantity,
        0,
      );
      const nextValue = usage.activeStalls + requestedDelta;
      const code = evaluateCountLimit(nextValue, version.maxStalls);
      if (code) throw new EntitlementError(code);
      const isUncappedPerStallUsage = version.pricingMode === "USAGE_PER_STALL_CAPPED"
        && version.usageScope === "STALL"
        && version.maxStalls === null;
      if (!isUncappedPerStallUsage && nextValue > version.includedStalls + approvedAdditional) {
        throw new EntitlementError("ADDITIONAL_STALL_APPROVAL_REQUIRED");
      }
    } else if (metricCode === "STAFF") {
      const code = evaluateCountLimit(usage.activeStaff + requestedDelta, version.maxStaff);
      if (code) throw new EntitlementError(code);
    } else if (metricCode === "PRODUCTS") {
      const code = evaluateCountLimit(usage.activeProducts + requestedDelta, version.maxProducts);
      if (code) throw new EntitlementError(code);
    } else if (metricCode === "QR_CODES") {
      const code = evaluateCountLimit(usage.activeQrCodes + requestedDelta, version.maxQrCodes);
      if (code) throw new EntitlementError(code);
    } else {
      const included = version.includedOrders;
      if (context.status === "TRIALING" && included !== null) {
        if (usage.billableOrders + requestedDelta > included) {
          throw new EntitlementError("TRIAL_ORDER_LIMIT_REACHED");
        }
      } else if (
        version.emergencyHardCapEnabled
        && version.emergencyHardCapOrders !== null
        && usage.billableOrders + requestedDelta
          > version.emergencyHardCapOrders + usage.orderPackageQuantity
      ) {
        throw new EntitlementError("ORDER_PACKAGE_REQUIRED");
      }
    }

    return { context, usage };
  }

  async getBillingPeriodUsage(organizationId: string, billingPeriod: Date) {
    const periodStart = monthStart(billingPeriod);
    const periodEnd = new Date(Date.UTC(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth() + 1,
      1,
    ));
    const context = await this.requireContext(organizationId);
    const [billableOrders, csvExports, activeStalls, activeProducts, activeQrCodes, staffRows] = await Promise.all([
      this.database.usageEvent.aggregate({
        where: { organizationId, billingPeriod: periodStart, eventType: "BILLABLE_ORDER_COMPLETED" },
        _sum: { quantity: true },
      }),
      this.database.usageEvent.aggregate({
        where: { organizationId, billingPeriod: periodStart, eventType: "CSV_EXPORTED" },
        _sum: { quantity: true },
      }),
      this.database.stall.count({ where: { organizationId, isActive: true } }),
      this.database.product.count({ where: { organizationId, isActive: true } }),
      this.database.qrCode.count({ where: { organizationId, state: { in: ["ACTIVE", "PAUSED"] } } }),
      this.database.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        select count(distinct member.profile_id)::bigint as count
        from (
          select membership.profile_id
          from public.organization_memberships membership
          where membership.organization_id = ${organizationId}::uuid
            and membership.is_active
            and membership.role <> 'ORGANIZATION_OWNER'::public.user_role
          union
          select membership.profile_id
          from public.stall_memberships membership
          where membership.organization_id = ${organizationId}::uuid
            and membership.is_active
        ) member
      `),
    ]);

    const orderPackageQuantity = context.items
      .filter((item) => (
        item.itemType === "ORDER_PACKAGE"
        && item.startsAt < periodEnd
        && (!item.endsAt || item.endsAt >= periodStart)
      ))
      .reduce((total, item) => total + orderPackageSize(item.code) * item.quantity, 0);

    return {
      billingPeriod: periodStart,
      billableOrders: billableOrders._sum.quantity ?? 0,
      activeStalls,
      activeStaff: Number(staffRows[0]?.count ?? 0),
      activeProducts,
      activeQrCodes,
      csvExports: csvExports._sum.quantity ?? 0,
      orderPackageQuantity,
    } satisfies BillingPeriodUsage;
  }

  async getUsageWarnings(organizationId: string) {
    const context = await this.requireContext(organizationId);
    const usage = await this.getBillingPeriodUsage(organizationId, context.billingPeriodStart);
    const includedOrders = context.planVersion.includedOrders;
    if (includedOrders === null) return [];
    const limit = includedOrders + (context.status === "TRIALING" ? 0 : usage.orderPackageQuantity);
    return calculateUsageWarningLevels(usage.billableOrders, limit).map((threshold) => ({
      threshold,
      used: usage.billableOrders,
      limit,
      percentage: limit === 0 ? 100 : Math.floor((usage.billableOrders * 100) / limit),
      severity: threshold >= 100 ? "CRITICAL" as const : threshold >= 90 ? "WARNING" as const : "INFO" as const,
    }));
  }

  private async requireContext(organizationId: string) {
    const context = await this.getSubscriptionContext(organizationId);
    if (!context) throw new EntitlementError("SUBSCRIPTION_NOT_ACTIVE");
    return context;
  }

  private async requireFeatureEntitlement(
    organizationId: string,
    featureCode: string,
    requireUsableSubscription: boolean,
  ) {
    if (await this.isOpenBetaFreeAccessEnabled()) {
      const context = await this.getFeatureSubscriptionContext(organizationId, featureCode);
      if (!context) throw new EntitlementError("SUBSCRIPTION_NOT_ACTIVE");
      this.ensureOpenBetaSubscriptionUsable(context);
      const planEntitlement = context.planVersion.entitlements[0];
      return {
        featureCode,
        isEnabled: true,
        limitValue: null,
        configuration: planEntitlement?.configurationJson ?? null,
        source: "OPEN_BETA",
      } satisfies EffectiveEntitlement;
    }
    const context = await this.getFeatureSubscriptionContext(organizationId, featureCode);
    if (!context) throw new EntitlementError("SUBSCRIPTION_NOT_ACTIVE");
    if (requireUsableSubscription) this.ensureSubscriptionUsable(context);

    const planEntitlement = resolvePlanEntitlements(context.planVersion)
      .find((entitlement) => entitlement.featureCode === featureCode);
    if (planEntitlement?.isEnabled) {
      return {
        featureCode: planEntitlement.featureCode,
        isEnabled: true,
        limitValue: planEntitlement.limitValue,
        configuration: planEntitlement.configuration,
        source: "PLAN",
      } satisfies EffectiveEntitlement;
    }

    const itemCodes = context.items.map((item) => item.code);
    if (itemCodes.length > 0) {
      const addOn = await this.database.addOnCatalog.findFirst({
        where: {
          code: { in: itemCodes },
          featureCode,
          isActive: true,
          availabilityStatus: { in: ["ENABLED", "MANUAL_APPROVAL_REQUIRED"] },
        },
        select: { featureCode: true },
      });
      if (addOn?.featureCode) {
        return {
          featureCode: addOn.featureCode,
          isEnabled: true,
          limitValue: null,
          configuration: null,
          source: "ADD_ON",
        } satisfies EffectiveEntitlement;
      }
    }

    throw new EntitlementError("FEATURE_NOT_INCLUDED");
  }

  private async isOpenBetaFreeAccessEnabled() {
    const candidate = this.database as unknown as {
      billingFeatureFlag?: {
        findMany?: (...args: never[]) => Promise<unknown>;
      };
    };
    if (typeof candidate.billingFeatureFlag?.findMany !== "function") return false;
    return isBillingFeatureEnabled(
      "OPEN_BETA_FREE_ACCESS_ENABLED",
      this.database,
    );
  }

  private async getFeatureSubscriptionContext(
    organizationId: string,
    featureCode: string,
  ): Promise<FeatureSubscriptionContext | null> {
    const now = new Date();
    return this.database.subscription.findUnique({
      where: { organizationId },
      select: {
        status: true,
        trialEndsAt: true,
        planVersion: {
          select: {
            version: true,
            plan: { select: { code: true } },
            entitlements: {
              where: { featureCode },
              select: {
                featureCode: true,
                isEnabled: true,
                limitValue: true,
                configurationJson: true,
              },
              take: 1,
            },
          },
        },
        items: {
          where: {
            itemType: "ADD_ON",
            status: "ACTIVE",
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
          select: { code: true },
        },
      },
    });
  }

  private ensureSubscriptionUsable(context: { status: string; trialEndsAt: Date | null }) {
    const code = evaluateSubscriptionUsability({
      status: context.status,
      trialEndsAt: context.trialEndsAt,
    });
    if (code) throw new EntitlementError(code);
  }

  private ensureOpenBetaSubscriptionUsable(context: { status: string }) {
    if (context.status === "SUSPENDED") {
      throw new EntitlementError("SUBSCRIPTION_SUSPENDED");
    }
    if (!["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(context.status)) {
      throw new EntitlementError("SUBSCRIPTION_NOT_ACTIVE");
    }
  }
}

export const entitlementService = new EntitlementService();

type PlanEntitlementSnapshot = {
  featureCode: string;
  isEnabled: boolean;
  limitValue: number | null;
  configurationJson: Prisma.JsonValue | null;
};

type PlanVersionEntitlementSnapshot = {
  version: number;
  plan: { code: string };
  entitlements: PlanEntitlementSnapshot[];
};

export function resolvePlanEntitlements(
  planVersion: PlanVersionEntitlementSnapshot,
): EffectiveEntitlement[] {
  const resolved = planVersion.entitlements.map((entitlement) => ({
    featureCode: entitlement.featureCode,
    isEnabled: entitlement.isEnabled,
    limitValue: entitlement.limitValue,
    configuration: entitlement.configurationJson,
    source: "PLAN" as const,
  }));
  const hasStoredPrinterEntitlement = resolved.some(
    (entitlement) => entitlement.featureCode === "PRINTER_INTEGRATION",
  );
  if (
    !hasStoredPrinterEntitlement
    && planVersion.version === 1
    && ["PRO", "ENTERPRISE"].includes(planVersion.plan.code)
  ) {
    resolved.push({
      featureCode: "PRINTER_INTEGRATION",
      isEnabled: true,
      limitValue: null,
      configuration: { merchantModuleOptIn: true },
      source: "PLAN",
    });
  }
  return resolved.sort((left, right) => left.featureCode.localeCompare(right.featureCode));
}

export function evaluateSubscriptionUsability(input: { status: string; trialEndsAt: Date | null }) {
  if (input.status === "SUSPENDED") return "SUBSCRIPTION_SUSPENDED" as const;
  if (input.status === "CANCELLED") return "SUBSCRIPTION_NOT_ACTIVE" as const;
  if (!["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(input.status)) {
    return "SUBSCRIPTION_NOT_ACTIVE" as const;
  }
  if (input.status === "TRIALING" && (!input.trialEndsAt || input.trialEndsAt <= new Date())) {
    return "TRIAL_EXPIRED" as const;
  }
  return null;
}

export function evaluateCountLimit(nextValue: number, limit: number | null) {
  return limit !== null && nextValue > limit ? "PLAN_LIMIT_REACHED" as const : null;
}

export function calculateUsageWarningLevels(used: number, limit: number) {
  if (limit <= 0) return used > 0 ? [80, 90, 100, 110] : [];
  return [80, 90, 100, 110].filter((threshold) => used * 100 >= limit * threshold);
}

export function canContinueOrderDuringSuspension(currentStatus: string, nextStatus: string) {
  return ["CONFIRMED", "PREPARING", "PACKING", "READY"].includes(currentStatus)
    && ["PREPARING", "PACKING", "READY", "COMPLETED", "CANCELLED"].includes(nextStatus);
}

export function entitlementErrorFromUnknown(error: unknown) {
  if (error instanceof EntitlementError) return error;
  const detail = errorDetail(error);
  const code = entitlementErrorCodes.find((candidate) => detail.includes(candidate));
  return code ? new EntitlementError(code) : null;
}

export function entitlementErrorPayload(error: EntitlementError) {
  return { error: error.message, code: error.code, status: error.status };
}

export function orderPackageSize(code: string) {
  if (code === "ORDER_PACKAGE_LITE_100") return 100;
  if (code === "ORDER_PACKAGE_STANDARD_500") return 500;
  if (code === "ORDER_PACKAGE_PRO_1000") return 1_000;
  return 0;
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function errorDetail(error: unknown) {
  if (!(error instanceof Error)) return String(error ?? "");
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `${error.message} ${String(error.meta?.message ?? "")}`;
  }
  return error.message;
}

// PrismaClient is structurally compatible with TransactionClient; this alias
// makes that contract visible to callers that need the same checks in a transaction.
export type EntitlementDatabase = Pick<PrismaClient, keyof BillingDatabase>;
