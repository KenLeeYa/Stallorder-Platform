import { z } from "zod";

const httpsOrRelativeUrlSchema = z.string().trim().max(2000).refine((value) => {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "請使用 HTTPS 網址或站內相對路徑。");

export const pickupDisplayThemeSchema = z.object({
  logoUrl: z.union([httpsOrRelativeUrlSchema, z.literal("")]).default(""),
  backgroundImageUrl: z.union([httpsOrRelativeUrlSchema, z.literal("")]).default(""),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "請輸入六位十六進位色碼。").default("#0f766e"),
});

export const pickupDisplaySettingsSchema = z.object({
  showCustomerName: z.boolean(),
  showPickupCode: z.boolean(),
  maskPickupCode: z.boolean(),
  readyRetentionMinutes: z.number().int().min(1).max(240),
  preparingRetentionMinutes: z.number().int().min(15).max(1440),
  enableVoice: z.boolean(),
  voiceLocale: z.string().trim().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).max(35),
  announcementText: z.string().trim().max(300),
  theme: pickupDisplayThemeSchema,
  isActive: z.boolean(),
});

export const pickupDisplayCommandSchema = z.discriminatedUnion("operation", [
  pickupDisplaySettingsSchema.extend({ operation: z.literal("UPDATE_SETTINGS") }),
  z.object({ operation: z.literal("ROTATE_TOKEN") }),
  z.object({ operation: z.literal("REVOKE_TOKEN") }),
]);

export type PickupDisplayTheme = z.infer<typeof pickupDisplayThemeSchema>;
export type PickupDisplaySettingsInput = z.infer<typeof pickupDisplaySettingsSchema>;

export type PickupDisplayOrder = {
  orderNo: string;
  pickupCode: string | null;
  customerName: string | null;
  status: "PREPARING" | "READY";
  readyAt: string | null;
};

export type PublicPickupDisplay = {
  stall: {
    name: string;
    slug: string;
    logoUrl: string | null;
    backgroundImageUrl: string | null;
  };
  appearance: {
    accentColor: string;
    announcementText: string | null;
  };
  voice: {
    enabled: boolean;
    locale: string;
  };
  menuUrl: string | null;
  preparing: PickupDisplayOrder[];
  ready: PickupDisplayOrder[];
  refreshedAt: string;
};

export type PickupDisplayManagerSettings = PickupDisplaySettingsInput & {
  tokenConfigured: boolean;
  voiceAvailable: boolean;
};

export function normalizePickupDisplayTheme(value: unknown): PickupDisplayTheme {
  const parsed = pickupDisplayThemeSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : pickupDisplayThemeSchema.parse({});
}

export function pickupCodeForDisplay(
  pickupCode: string | null,
  showPickupCode: boolean,
  maskPickupCode: boolean,
) {
  if (!showPickupCode || !pickupCode) return null;
  if (!maskPickupCode) return pickupCode;
  if (pickupCode.length === 1) return "•";
  return `${"•".repeat(pickupCode.length - 1)}${pickupCode.slice(-1)}`;
}

export function pickupAnnouncementKey(order: PickupDisplayOrder) {
  return `${order.orderNo}:${order.readyAt ?? "ready"}`;
}

export function collectUnannouncedReadyOrders(
  orders: readonly PickupDisplayOrder[],
  announcedKeys: readonly string[],
) {
  const known = new Set(announcedKeys);
  const unannounced = orders.filter((order) => !known.has(pickupAnnouncementKey(order)));
  const nextKeys = [
    ...announcedKeys,
    ...unannounced.map(pickupAnnouncementKey),
  ].slice(-200);
  return { unannounced, nextKeys };
}

export function pickupVoiceMessage(order: PickupDisplayOrder) {
  return order.pickupCode
    ? `${order.orderNo} 號餐點已完成，請憑取餐碼 ${order.pickupCode} 至櫃台取餐。`
    : `${order.orderNo} 號餐點已完成，請至櫃台取餐。`;
}

export function cdsVoiceAvailable(configuration: unknown) {
  return Boolean(
    configuration
    && typeof configuration === "object"
    && !Array.isArray(configuration)
    && "voiceAnnouncements" in configuration
    && configuration.voiceAnnouncements === true,
  );
}
