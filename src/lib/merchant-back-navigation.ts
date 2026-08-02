export const merchantBackSources = ["kitchen", "staff", "setup", "stall-products", "localization"] as const;

export type MerchantBackSource = (typeof merchantBackSources)[number];

type BackNavigationInput = {
  source?: string;
  allowedSources?: readonly MerchantBackSource[];
  organizationId?: string;
  stallId?: string;
  stallSlug?: string;
};

export type MerchantBackNavigation = { href: string; label: string };

export function parseMerchantBackSource(value: string | undefined): MerchantBackSource | undefined {
  return merchantBackSources.find((source) => source === value);
}

export function resolveMerchantBackNavigation({
  source: rawSource,
  allowedSources = merchantBackSources,
  organizationId,
  stallId,
  stallSlug,
}: BackNavigationInput): MerchantBackNavigation | null {
  const parsedSource = parseMerchantBackSource(rawSource);
  const source = parsedSource && allowedSources.includes(parsedSource) ? parsedSource : undefined;

  if (source === "kitchen" && stallSlug) {
    return {
      href: `/kitchen?stall=${encodeURIComponent(stallSlug)}`,
      label: "返回生產看板",
    };
  }
  if (source === "staff" && stallSlug) {
    return {
      href: `/staff/${encodeURIComponent(stallSlug)}`,
      label: "返回店員訂單",
    };
  }
  if (source === "setup" && organizationId) {
    return {
      href: `/merchant/setup?organizationId=${encodeURIComponent(organizationId)}`,
      label: "返回開店設定",
    };
  }
  if (source === "stall-products" && stallSlug) {
    return {
      href: `/merchant/${encodeURIComponent(stallSlug)}`,
      label: "返回商品供應",
    };
  }
  if (source === "localization" && organizationId) {
    const query = new URLSearchParams({ organizationId });
    if (stallId) query.set("stallId", stallId);
    return {
      href: `/merchant/localization?${query.toString()}`,
      label: "返回翻譯完整度",
    };
  }
  if (stallId) {
    return {
      href: `/merchant/stalls/${encodeURIComponent(stallId)}`,
      label: "返回攤位設定",
    };
  }
  return null;
}
