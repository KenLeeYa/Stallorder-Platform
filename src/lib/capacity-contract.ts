import { z } from "zod";

export type CapacityPauseSource = "NONE" | "AUTO" | "MANUAL";

export type CapacitySnapshot = {
  quoteMinMinutes: number;
  quoteMaxMinutes: number;
  acknowledgmentThresholdMinutes: number;
  requiresAcknowledgment: boolean;
  utilizationPercent: number;
  orderCount: number;
  itemCount: number;
  requestedItemCount: number;
  weightedLoad: number;
  requestedWeight: number;
  effectiveThroughputPerMinute: number;
  activeStationCount: number;
  warningUtilizationPercent: number;
  pauseUtilizationPercent: number;
  productLimitExceeded: boolean;
  pauseSource: CapacityPauseSource;
  autoPauseEnabled: boolean;
  autoResumeEnabled: boolean;
  acceptingPublicOrders: boolean;
  windowStart: string | null;
  windowEnd: string | null;
};

export type CapacityCapabilities = {
  waitTimeQuote: boolean;
  automaticControl: boolean;
  productRules: boolean;
  maxProductRules: number | null;
};

export type CapacitySettingsDto = {
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
  pauseSource: CapacityPauseSource;
  isActive: boolean;
};

export type StaffCapacityData = {
  settings: Pick<CapacitySettingsDto,
    | "manualWaitMinutes"
    | "autoPauseEnabled"
    | "autoResumeEnabled"
    | "pauseSource"
    | "isActive">;
  snapshot: CapacitySnapshot;
  capabilities: CapacityCapabilities;
};

export type CapacityManagerData = {
  settings: CapacitySettingsDto;
  snapshot: CapacitySnapshot;
  capabilities: CapacityCapabilities;
  products: Array<{ id: string; name: string }>;
  rules: Array<{
    id: string;
    productId: string;
    productName: string;
    capacityWeight: number;
    prepMinutes: number;
    maxQuantityPerWindow: number | null;
    isActive: boolean;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    orderCount: number;
    itemCount: number;
    weightedLoad: number;
    estimatedWaitMinutes: number;
    reason: string;
    createdAt: string;
  }>;
};

const uuid = z.string().uuid();
const reason = z.string().trim().min(3, "請填寫至少 3 個字的原因。").max(200);

const capacitySettingsFields = {
  windowMinutes: z.number().int().min(5).max(120),
  maxOrdersPerWindow: z.number().int().min(1).max(1_000),
  maxItemsPerWindow: z.number().int().min(1).max(5_000),
  warningUtilizationPercent: z.number().int().min(1).max(99),
  pauseUtilizationPercent: z.number().int().min(2).max(200),
  defaultPrepMinutes: z.number().int().min(0).max(240),
  minimumQuoteMinutes: z.number().int().min(0).max(240),
  maximumQuoteMinutes: z.number().int().min(0).max(480),
  quoteBufferMinutes: z.number().int().min(0).max(60),
  acknowledgmentThresholdMinutes: z.number().int().min(1).max(480),
  autoPauseEnabled: z.boolean(),
  autoResumeEnabled: z.boolean(),
  isActive: z.boolean(),
};

const updateSettingsSchema = z.object({
  operation: z.literal("UPDATE_SETTINGS"),
  ...capacitySettingsFields,
}).strict().superRefine((value, context) => {
  if (value.pauseUtilizationPercent <= value.warningUtilizationPercent) {
    context.addIssue({
      code: "custom",
      path: ["pauseUtilizationPercent"],
      message: "自動暫停門檻必須高於警示門檻。",
    });
  }
  if (value.maximumQuoteMinutes < value.minimumQuoteMinutes) {
    context.addIssue({
      code: "custom",
      path: ["maximumQuoteMinutes"],
      message: "最長報價時間不得小於最短報價時間。",
    });
  }
  if (value.autoResumeEnabled && !value.autoPauseEnabled) {
    context.addIssue({
      code: "custom",
      path: ["autoResumeEnabled"],
      message: "啟用自動恢復前，必須先啟用自動暫停。",
    });
  }
});

const operationalCommands = [
  z.object({
    operation: z.literal("SET_WAIT_OVERRIDE"),
    minutes: z.number().int().min(0).max(480).nullable(),
    reason,
  }).strict(),
  z.object({
    operation: z.literal("SET_AUTO_PAUSE"),
    enabled: z.boolean(),
    reason,
  }).strict(),
  z.object({ operation: z.literal("PAUSE_ORDERING"), reason }).strict(),
  z.object({ operation: z.literal("RESUME_ORDERING"), reason }).strict(),
] as const;

export const capacityStaffCommandSchema = z.discriminatedUnion("operation", operationalCommands);

export const capacityMerchantCommandSchema = z.discriminatedUnion("operation", [
  updateSettingsSchema,
  ...operationalCommands,
  z.object({
    operation: z.literal("UPSERT_PRODUCT_RULE"),
    productId: uuid,
    capacityWeight: z.number().min(0.1).max(100),
    prepMinutes: z.number().int().min(0).max(240),
    maxQuantityPerWindow: z.number().int().min(1).max(5_000).nullable(),
    isActive: z.boolean(),
  }).strict(),
  z.object({
    operation: z.literal("DELETE_PRODUCT_RULE"),
    productId: uuid,
  }).strict(),
]);

const capacityFieldLabels: Record<string, string> = {
  windowMinutes: "統計時間窗",
  maxOrdersPerWindow: "每個時間窗最大訂單數",
  maxItemsPerWindow: "每個時間窗最大餐點數",
  warningUtilizationPercent: "警示使用率",
  pauseUtilizationPercent: "暫停接單使用率",
  defaultPrepMinutes: "基本製餐時間",
  minimumQuoteMinutes: "最短等候時間",
  maximumQuoteMinutes: "最長等候時間",
  quoteBufferMinutes: "等候時間緩衝",
  acknowledgmentThresholdMinutes: "需確認的等候時間",
  autoPauseEnabled: "自動暫停接單",
  autoResumeEnabled: "自動恢復接單",
  isActive: "啟用產能估算",
  minutes: "等候時間",
  reason: "操作原因",
  productId: "商品",
  capacityWeight: "產能權重",
  prepMinutes: "製餐時間",
  maxQuantityPerWindow: "時間窗商品上限",
};

export function getCapacityFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    if (fieldErrors[field]) continue;
    const label = capacityFieldLabels[field] ?? "欄位";
    fieldErrors[field] = issue.code === "custom"
      ? issue.message
      : `「${label}」輸入不正確，請依欄位限制重新輸入。`;
  }
  return fieldErrors;
}

export type CapacityStaffCommand = z.infer<typeof capacityStaffCommandSchema>;
export type CapacityMerchantCommand = z.infer<typeof capacityMerchantCommandSchema>;

export function parseCapacitySnapshot(value: unknown): CapacitySnapshot {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    quoteMinMinutes: safeNumber(row.quote_min_minutes),
    quoteMaxMinutes: safeNumber(row.quote_max_minutes),
    acknowledgmentThresholdMinutes: safeNumber(row.acknowledgment_threshold_minutes, 480),
    requiresAcknowledgment: row.requires_acknowledgment === true,
    utilizationPercent: safeNumber(row.utilization_percent),
    orderCount: safeNumber(row.order_count),
    itemCount: safeNumber(row.item_count),
    requestedItemCount: safeNumber(row.requested_item_count),
    weightedLoad: safeNumber(row.weighted_load),
    requestedWeight: safeNumber(row.requested_weight),
    effectiveThroughputPerMinute: safeNumber(row.effective_throughput_per_minute),
    activeStationCount: safeNumber(row.active_station_count, 1),
    warningUtilizationPercent: safeNumber(row.warning_utilization_percent, 75),
    pauseUtilizationPercent: safeNumber(row.pause_utilization_percent, 100),
    productLimitExceeded: row.product_limit_exceeded === true,
    pauseSource: normalizeCapacityPauseSource(row.pause_source),
    autoPauseEnabled: row.auto_pause_enabled === true,
    autoResumeEnabled: row.auto_resume_enabled === true,
    acceptingPublicOrders: row.accepting_public_orders === true,
    windowStart: safeDateString(row.window_start),
    windowEnd: safeDateString(row.window_end),
  };
}

export function capacityCapabilities(configuration: unknown) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    return { automaticControl: false, productRules: false };
  }
  const value = configuration as Record<string, unknown>;
  return {
    automaticControl: value.automaticControl === true,
    productRules: value.productRules === true,
  };
}

export function formatWaitQuote(minimumMinutes: number, maximumMinutes: number) {
  return minimumMinutes === maximumMinutes
    ? `${maximumMinutes} 分鐘`
    : `${minimumMinutes}～${maximumMinutes} 分鐘`;
}

function safeNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeDateString(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function normalizeCapacityPauseSource(value: unknown): CapacityPauseSource {
  return value === "AUTO" || value === "MANUAL" ? value : "NONE";
}
