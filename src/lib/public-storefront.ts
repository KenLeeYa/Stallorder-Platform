import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const ACTIVE_ORGANIZATION_STATUSES = new Set([
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
]);
const PUBLIC_STOREFRONT_IDENTIFIER = /^[a-z0-9-]{2,50}$/;
const BLOCKED_NAVIGATION_QUERY_KEYS = new Set([
  "callbackurl",
  "continue",
  "destination",
  "next",
  "redirect",
  "redirectto",
  "returnto",
  "url",
]);

export type PublicStorefrontView = "menu" | "pickup" | "delivery";
export type PublicStorefrontSearchParams = Record<string, string | string[] | undefined>;

const publicStorefrontStallSelect = {
  id: true,
  name: true,
  slug: true,
  code: true,
  location: true,
  currency: true,
  timezone: true,
  isActive: true,
  organization: { select: { status: true } },
  orderingSettings: {
    select: {
      takeoutPreorderEnabled: true,
      deliveryModuleEnabled: true,
    },
  },
  qrCodes: {
    where: {
      diningTableId: null,
      marketEventId: null,
      stallScheduleId: null,
      locationId: null,
      state: "ACTIVE",
      OR: [
        { fulfillmentTypeContext: null },
        { fulfillmentTypeContext: { in: ["TAKEOUT", "DELIVERY"] } },
      ],
    },
    orderBy: [{ tokenVersion: "desc" }, { updatedAt: "desc" }],
    select: {
      token: true,
      fulfillmentTypeContext: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.StallSelect;

export type PublicStorefrontStall = Prisma.StallGetPayload<{
  select: typeof publicStorefrontStallSelect;
}>;

type ResolvablePublicStall = {
  code: string;
  slug: string;
  isActive: boolean;
  organization: { status: string };
};

type PublicStorefrontCodeLookup<T extends ResolvablePublicStall> = {
  findByCanonicalCode: (canonicalCode: string) => Promise<readonly T[]>;
};

type LegacyPublicStorefrontSlugLookup<T extends ResolvablePublicStall> = {
  findByLegacySlug: (legacySlug: string) => Promise<T | null>;
};

export type PublicStorefrontResolution<T extends ResolvablePublicStall = PublicStorefrontStall> = {
  stall: T;
  canonicalIdentifier: string;
  matchedBy: "canonical-code" | "legacy-slug";
};

export function normalizePublicStorefrontIdentifier(value: string) {
  const normalized = value.trim().toLowerCase();
  return PUBLIC_STOREFRONT_IDENTIFIER.test(normalized) ? normalized : null;
}

export async function resolvePublicStorefrontIdentifier<T extends ResolvablePublicStall>(
  identifier: string,
  lookup: PublicStorefrontCodeLookup<T>,
): Promise<PublicStorefrontResolution<T> | null> {
  const normalized = normalizePublicStorefrontIdentifier(identifier);
  if (!normalized) return null;

  const codeMatches = await lookup.findByCanonicalCode(normalized);
  if (codeMatches.length !== 1 || !publicStorefrontStallIsVisible(codeMatches[0])) return null;
  const canonicalIdentifier = normalizePublicStorefrontIdentifier(codeMatches[0].code);
  return canonicalIdentifier
    ? { stall: codeMatches[0], canonicalIdentifier, matchedBy: "canonical-code" }
    : null;
}

export async function resolveLegacyPublicStorefrontSlugIdentifier<T extends ResolvablePublicStall>(
  stallSlug: string,
  lookup: LegacyPublicStorefrontSlugLookup<T>,
): Promise<PublicStorefrontResolution<T> | null> {
  if (!PUBLIC_STOREFRONT_IDENTIFIER.test(stallSlug)) return null;

  const legacyMatch = await lookup.findByLegacySlug(stallSlug);
  if (!legacyMatch || !publicStorefrontStallIsVisible(legacyMatch)) return null;
  const canonicalIdentifier = normalizePublicStorefrontIdentifier(legacyMatch.code);
  return canonicalIdentifier
    ? { stall: legacyMatch, canonicalIdentifier, matchedBy: "legacy-slug" }
    : null;
}

export async function resolvePublicStorefront(identifier: string) {
  return resolvePublicStorefrontIdentifier(identifier, {
    findByCanonicalCode: (canonicalCode) => prisma.stall.findMany({
      where: { code: { equals: canonicalCode, mode: "insensitive" } },
      select: publicStorefrontStallSelect,
      take: 2,
    }),
  });
}

export async function resolveLegacyPublicStorefrontSlug(stallSlug: string) {
  return resolveLegacyPublicStorefrontSlugIdentifier(stallSlug, {
    findByLegacySlug: (legacySlug) => prisma.stall.findUnique({
      where: { slug: legacySlug },
      select: publicStorefrontStallSelect,
    }),
  });
}

export function selectPublicStorefrontQrToken(
  qrCodes: ReadonlyArray<{
    token: string;
    fulfillmentTypeContext: string | null;
    expiresAt: Date | null;
  }>,
  view: "pickup" | "delivery",
  now = Date.now(),
) {
  const acceptedContexts = view === "pickup"
    ? new Set([null, "TAKEOUT"])
    : new Set([null, "DELIVERY"]);
  return qrCodes.find((qrCode) => (
    acceptedContexts.has(qrCode.fulfillmentTypeContext)
    && (!qrCode.expiresAt || qrCode.expiresAt.getTime() > now)
  ))?.token ?? null;
}

export function resolvePublicStorefrontView(value: string | string[] | undefined): PublicStorefrontView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "pickup" || candidate === "delivery" ? candidate : "menu";
}

export function buildPublicStorefrontPath(
  identifier: string,
  view?: PublicStorefrontView,
  searchParams: PublicStorefrontSearchParams = {},
) {
  const query = new URLSearchParams();
  let copiedValues = 0;
  for (const [key, rawValue] of Object.entries(searchParams)) {
    const normalizedKey = key.toLowerCase();
    if (
      key === "view"
      || !/^[a-zA-Z0-9_.-]{1,64}$/.test(key)
      || BLOCKED_NAVIGATION_QUERY_KEYS.has(normalizedKey)
    ) continue;
    const values = Array.isArray(rawValue) ? rawValue : rawValue === undefined ? [] : [rawValue];
    for (const value of values) {
      if (copiedValues >= 20 || value.length > 500) break;
      query.append(key, value);
      copiedValues += 1;
    }
  }
  if (view) query.set("view", view);
  const suffix = query.toString();
  return `/store/${encodeURIComponent(identifier)}${suffix ? `?${suffix}` : ""}`;
}

function publicStorefrontStallIsVisible(stall: ResolvablePublicStall) {
  return stall.isActive && ACTIVE_ORGANIZATION_STATUSES.has(stall.organization.status);
}
