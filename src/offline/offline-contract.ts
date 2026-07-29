import { z } from "zod";

export const OFFLINE_DATABASE_NAME = "stallorder-offline-pos";
export const OFFLINE_DATABASE_VERSION = 1;
export const OFFLINE_SCHEMA_VERSION = 1;
export const OFFLINE_APP_PROTOCOL_VERSION = "1";

export const offlineStorageClasses = [
  "PERSISTENT",
  "BEST_EFFORT",
  "INSUFFICIENT",
  "UNAVAILABLE",
] as const;

export type OfflineStorageClass = (typeof offlineStorageClasses)[number];

export const offlineWriteModes = [
  "DISABLED",
  "SINGLE_DEVICE_ONLY",
  "LOCAL_GATEWAY_FUTURE",
] as const;

export type OfflineWriteMode = (typeof offlineWriteModes)[number];

export const offlineDeviceStatuses = [
  "ACTIVE",
  "REVOKED",
  "LOST",
  "REPLACED",
  "DISABLED",
] as const;

export type OfflineDeviceStatus = (typeof offlineDeviceStatuses)[number];

export const offlineDeviceRoles = [
  "OFFLINE_LEADER",
  "OFFLINE_READ_ONLY",
  "NONE",
] as const;

export type OfflineDeviceRole = (typeof offlineDeviceRoles)[number];

const safeText = (minimum: number, maximum: number, label: string) => z.string()
  .trim()
  .min(minimum, `${label}不可空白。`)
  .max(maximum, `${label}不可超過 ${maximum} 個字元。`)
  .transform((value) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " "));

export const registerOfflineDeviceSchema = z.object({
  installationId: z.string().uuid("裝置安裝識別碼格式不正確。"),
  displayName: safeText(1, 80, "裝置名稱"),
  platform: safeText(1, 80, "裝置平台"),
  appVersion: z.string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/, "應用程式版本格式不正確。"),
  pwaInstalled: z.boolean(),
}).strict();

const offlineLimitsSchema = z.object({
  maxOfflineDurationMinutes: z.number().int().min(15).max(720),
  maxPendingOrders: z.number().int().min(1).max(500),
  maxTotalAmount: z.number().min(0).max(99_999_999.99),
  maxSingleOrderAmount: z.number().min(0).max(99_999_999.99),
}).superRefine((value, context) => {
  if (value.maxSingleOrderAmount > value.maxTotalAmount) {
    context.addIssue({
      code: "custom",
      path: ["maxSingleOrderAmount"],
      message: "單筆離線訂單上限不可高於離線累計金額上限。",
    });
  }
});

export const updateOfflinePolicySchema = z.object({
  operation: z.literal("UPDATE_POLICY"),
  offlineEnabled: z.boolean(),
  offlineWriteMode: z.enum(["DISABLED", "SINGLE_DEVICE_ONLY"]),
  offlineLeaderDeviceId: z.string().uuid().nullable(),
  limits: offlineLimitsSchema,
  reason: safeText(5, 500, "異動原因"),
}).strict().superRefine((value, context) => {
  if (
    value.offlineEnabled !== (value.offlineWriteMode === "SINGLE_DEVICE_ONLY")
    || (value.offlineEnabled && !value.offlineLeaderDeviceId)
    || (!value.offlineEnabled && value.offlineLeaderDeviceId)
  ) {
    context.addIssue({
      code: "custom",
      message: "離線啟用狀態、寫入模式與 Leader 裝置設定不一致。",
    });
  }
});

export const updateOfflineDeviceSchema = z.object({
  operation: z.literal("UPDATE_DEVICE"),
  deviceId: z.string().uuid("裝置識別碼格式不正確。"),
  action: z.enum(["APPROVE_READ_ONLY", "DISABLE", "REVOKE", "MARK_LOST"]),
  reason: safeText(5, 500, "異動原因"),
}).strict();

export const offlineManagementCommandSchema = z.discriminatedUnion("operation", [
  updateOfflinePolicySchema,
  updateOfflineDeviceSchema,
]);

export type OfflineManagementCommand = z.infer<typeof offlineManagementCommandSchema>;

export const offlineBootstrapSchema = z.object({
  installationId: z.string().uuid("裝置安裝識別碼格式不正確。"),
  storageClass: z.enum(offlineStorageClasses),
  requestedDurationMinutes: z.number().int().min(15).max(720),
  appProtocolVersion: z.literal(OFFLINE_APP_PROTOCOL_VERSION),
}).strict();

export type OfflineBootstrapCommand = z.infer<typeof offlineBootstrapSchema>;

export type OfflineRuntimeLimits = z.infer<typeof offlineLimitsSchema>;

export const offlineAllowedActions = [
  "CREATE_OFFLINE_ORDER",
  "RECORD_CASH_PAYMENT",
  "QUEUE_PRINT_JOB",
] as const;

export type OfflineAllowedAction = (typeof offlineAllowedActions)[number];
