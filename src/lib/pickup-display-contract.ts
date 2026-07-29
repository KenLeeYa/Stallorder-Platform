import { z } from "zod";

export * from "@/lib/pickup-display-client";

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

export type PickupDisplayManagerSettings = PickupDisplaySettingsInput & {
  tokenConfigured: boolean;
  voiceAvailable: boolean;
};

export function normalizePickupDisplayTheme(value: unknown): PickupDisplayTheme {
  const parsed = pickupDisplayThemeSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : pickupDisplayThemeSchema.parse({});
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
