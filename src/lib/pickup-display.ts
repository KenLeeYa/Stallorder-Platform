import "server-only";

import { prisma } from "@/lib/prisma";
import {
  cdsVoiceAvailable,
  normalizePickupDisplayTheme,
  pickupCodeForDisplay,
  type PickupDisplayManagerSettings,
  type PublicPickupDisplay,
} from "@/lib/pickup-display-contract";
import { entitlementService } from "@/server/billing/entitlement-service";

const DISPLAYABLE_ORGANIZATION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
] as const;
const PREPARING_STATUSES = ["CONFIRMED", "PREPARING", "PACKING"] as const;

const publicSettingsSelect = {
  organizationId: true,
  stallId: true,
  showCustomerName: true,
  showPickupCode: true,
  maskPickupCode: true,
  readyRetentionMinutes: true,
  preparingRetentionMinutes: true,
  enableVoice: true,
  voiceLocale: true,
  announcementText: true,
  themeJson: true,
  isActive: true,
  stall: {
    select: {
      name: true,
      slug: true,
      logoUrl: true,
      coverImageUrl: true,
      qrCodes: {
        where: {
          state: "ACTIVE" as const,
          diningTableId: null,
        },
        orderBy: { createdAt: "desc" as const },
        take: 10,
        select: { token: true, expiresAt: true },
      },
    },
  },
};

type PublicSettingsRecord = NonNullable<Awaited<ReturnType<typeof findPublicSettingsBySlug>>>;

export async function getPickupDisplayManagerSettings(
  organizationId: string,
  stallId: string,
): Promise<PickupDisplayManagerSettings> {
  const [settings, entitlement] = await Promise.all([
    prisma.pickupDisplaySettings.findFirst({
      where: { organizationId, stallId },
      select: {
        displayTokenHash: true,
        showCustomerName: true,
        showPickupCode: true,
        maskPickupCode: true,
        readyRetentionMinutes: true,
        preparingRetentionMinutes: true,
        enableVoice: true,
        voiceLocale: true,
        announcementText: true,
        themeJson: true,
        isActive: true,
      },
    }),
    entitlementService.assertFeatureEnabled(organizationId, "CDS"),
  ]);

  const theme = normalizePickupDisplayTheme(settings?.themeJson);
  return {
    showCustomerName: settings?.showCustomerName ?? false,
    showPickupCode: settings?.showPickupCode ?? true,
    maskPickupCode: settings?.maskPickupCode ?? false,
    readyRetentionMinutes: settings?.readyRetentionMinutes ?? 30,
    preparingRetentionMinutes: settings?.preparingRetentionMinutes ?? 180,
    enableVoice: settings?.enableVoice ?? false,
    voiceLocale: settings?.voiceLocale ?? "zh-TW",
    announcementText: settings?.announcementText ?? "",
    theme,
    isActive: settings?.isActive ?? false,
    tokenConfigured: Boolean(settings?.displayTokenHash),
    voiceAvailable: cdsVoiceAvailable(entitlement.configuration),
  };
}

export async function getPublicPickupDisplayBySlug(stallSlug: string) {
  const settings = await findPublicSettingsBySlug(stallSlug);
  return settings ? buildPublicPickupDisplay(settings) : null;
}

export async function getPublicPickupDisplayByTokenHash(displayTokenHash: string) {
  const settings = await prisma.pickupDisplaySettings.findFirst({
    where: {
      displayTokenHash,
      isActive: true,
      stall: {
        isActive: true,
        organization: { status: { in: [...DISPLAYABLE_ORGANIZATION_STATUSES] } },
      },
    },
    select: publicSettingsSelect,
  });
  return settings ? buildPublicPickupDisplay(settings) : null;
}

export async function pickupDisplayAccessBySlug(stallSlug: string) {
  return findPublicSettingsBySlug(stallSlug);
}

export async function pickupDisplayAccessByTokenHash(displayTokenHash: string) {
  return prisma.pickupDisplaySettings.findFirst({
    where: {
      displayTokenHash,
      isActive: true,
      stall: {
        isActive: true,
        organization: { status: { in: [...DISPLAYABLE_ORGANIZATION_STATUSES] } },
      },
    },
    select: { organizationId: true, stallId: true },
  });
}

async function findPublicSettingsBySlug(stallSlug: string) {
  return prisma.pickupDisplaySettings.findFirst({
    where: {
      isActive: true,
      stall: {
        slug: stallSlug,
        isActive: true,
        organization: { status: { in: [...DISPLAYABLE_ORGANIZATION_STATUSES] } },
      },
    },
    select: publicSettingsSelect,
  });
}

async function buildPublicPickupDisplay(
  settings: PublicSettingsRecord,
): Promise<PublicPickupDisplay | null> {
  try {
    await entitlementService.assertFeatureEnabled(settings.organizationId, "CDS");
  } catch {
    return null;
  }

  const now = new Date();
  const preparingCutoff = new Date(now.getTime() - settings.preparingRetentionMinutes * 60_000);
  const readyCutoff = new Date(now.getTime() - settings.readyRetentionMinutes * 60_000);
  const orders = await prisma.order.findMany({
    where: {
      organizationId: settings.organizationId,
      stallId: settings.stallId,
      fulfillmentType: { not: "DELIVERY" },
      OR: [
        {
          status: { in: [...PREPARING_STATUSES] },
          createdAt: { gte: preparingCutoff },
        },
        {
          status: "READY",
          updatedAt: { gte: readyCutoff },
        },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { orderNo: "asc" }],
    take: 200,
    select: {
      orderNo: true,
      pickupCodeDisplay: true,
      customerName: true,
      status: true,
      updatedAt: true,
    },
  });

  const theme = normalizePickupDisplayTheme(settings.themeJson);
  const projected = orders.map((order) => ({
    orderNo: order.orderNo,
    pickupCode: pickupCodeForDisplay(
      order.pickupCodeDisplay,
      settings.showPickupCode,
      settings.maskPickupCode,
    ),
    customerName: settings.showCustomerName ? order.customerName : null,
    status: order.status === "READY" ? "READY" as const : "PREPARING" as const,
    readyAt: order.status === "READY" ? order.updatedAt.toISOString() : null,
  }));
  const menuToken = settings.stall.qrCodes.find((qrCode) => (
    !qrCode.expiresAt || qrCode.expiresAt > now
  ))?.token;

  return {
    stall: {
      name: settings.stall.name,
      slug: settings.stall.slug,
      logoUrl: safePublicAssetUrl(theme.logoUrl || settings.stall.logoUrl),
      backgroundImageUrl: safePublicAssetUrl(
        theme.backgroundImageUrl || settings.stall.coverImageUrl,
      ),
    },
    appearance: {
      accentColor: theme.accentColor,
      announcementText: settings.announcementText || null,
    },
    voice: {
      enabled: settings.enableVoice,
      locale: settings.voiceLocale,
    },
    menuUrl: menuToken ? `/q/${encodeURIComponent(menuToken)}` : null,
    preparing: projected.filter((order) => order.status === "PREPARING"),
    ready: projected.filter((order) => order.status === "READY"),
    refreshedAt: now.toISOString(),
  };
}

function safePublicAssetUrl(value: string | null) {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
