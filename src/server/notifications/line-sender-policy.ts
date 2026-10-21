import { lineIntegrationSettingsSchema } from "@/lib/line-notification-contract";

export function resolveLegacyLineSender(input: {
  settings: unknown;
  providerId: string | null;
  destination: string | null;
  recipientProviderId?: string;
}) {
  const parsed = lineIntegrationSettingsSchema.safeParse(input.settings);
  const management = parsed.success ? parsed.data.webhookManagement : undefined;
  const policy = management?.senderPolicy ?? "MERCHANT_OA";
  if (!management || !input.providerId || !input.destination || input.recipientProviderId !== input.providerId) {
    return { policy, sender: "NONE", reason: "SAME_PROVIDER_BINDING_REQUIRED" } as const;
  }
  if (policy === "PLATFORM_OA") {
    return { policy, sender: "NONE", reason: "PLATFORM_ORDER_BINDING_REQUIRED" } as const;
  }
  return { policy, sender: "MERCHANT_OA", reason: null } as const;
}
