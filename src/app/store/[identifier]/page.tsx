import type { Metadata } from "next";
import { cache } from "react";
import { CalendarDays, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { QrOrderFlow } from "@/components/qr-order-flow";
import { isAppLocale, type AppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { publicMessages } from "@/lib/messages/public";
import {
  getCachedPublicDisplayMenuForStallSlug,
  getCachedPublicMenuForQrToken,
  getLivePublicDisplayMenuForStallSlug,
} from "@/lib/public-menu";
import {
  buildPublicStorefrontPath,
  resolvePublicStorefront,
  resolvePublicStorefrontView,
  selectPublicStorefrontQrToken,
  type PublicStorefrontSearchParams,
  type PublicStorefrontView,
} from "@/lib/public-storefront";
import { PublicMenuView } from "./public-menu-view";
import { StorefrontModeNav } from "./storefront-mode-nav";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ identifier: string }>;
  searchParams: Promise<PublicStorefrontSearchParams>;
};

const getStorefront = cache(resolvePublicStorefront);

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ identifier }, query, requestLocale] = await Promise.all([
    params,
    searchParams,
    getRequestAppLocale(),
  ]);
  const { locale } = resolveStorefrontLocale(query, requestLocale.locale);
  const resolution = await getStorefront(identifier);
  if (!resolution) return {
    title: publicMessages.get(locale, "storefrontNotFoundTitle"),
    robots: { index: false, follow: false },
  };

  const view = resolvePublicStorefrontView(query.view);
  const viewLabel = storefrontViewLabel(locale, view);
  const title = `${resolution.stall.name}｜${viewLabel}`;
  const description = view === "menu"
    ? publicMessages.get(locale, "storefrontMenuDescription", { stallName: resolution.stall.name })
    : publicMessages.get(locale, "storefrontOrderDescription", {
        stallName: resolution.stall.name,
        mode: viewLabel,
      });
  return {
    title,
    description,
    alternates: { canonical: buildPublicStorefrontPath(resolution.canonicalIdentifier) },
    robots: view === "menu" ? undefined : { index: false, follow: false },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: publicMessages.get(locale, "storefrontSiteName"),
    },
  };
}

export default async function PublicStorefrontPage({ params, searchParams }: PageProps) {
  const [{ identifier }, query, requestLocale] = await Promise.all([
    params,
    searchParams,
    getRequestAppLocale(),
  ]);
  const { locale, requestedLocale } = resolveStorefrontLocale(query, requestLocale.locale);
  const resolution = await getStorefront(identifier);
  if (!resolution) notFound();

  const view = resolvePublicStorefrontView(query.view);
  const editTrackingToken = resolveEditTrackingToken(query.editOrder);
  if (identifier !== resolution.canonicalIdentifier) {
    redirect(buildPublicStorefrontPath(
      resolution.canonicalIdentifier,
      query.view === undefined ? undefined : view,
      query,
    ));
  }

  const { stall } = resolution;
  const pickupQrToken = selectPublicStorefrontQrToken(stall.qrCodes, "pickup");
  const deliveryQrToken = selectPublicStorefrontQrToken(stall.qrCodes, "delivery");
  const displayMenuPromise = view === "menu"
    ? query.fresh === undefined
      ? getCachedPublicDisplayMenuForStallSlug(stall.slug)
      : getLivePublicDisplayMenuForStallSlug(stall.slug)
    : null;
  const selectedOrderMenuPromise = view === "pickup"
    ? stall.orderingSettings?.takeoutPreorderEnabled && pickupQrToken
      ? getCachedPublicMenuForQrToken(pickupQrToken, "PREORDER")
      : null
    : view === "delivery"
      ? stall.orderingSettings?.deliveryModuleEnabled && deliveryQrToken
        ? getCachedPublicMenuForQrToken(deliveryQrToken, "DELIVERY")
        : null
      : null;
  const [menu, selectedOrderMenu] = await Promise.all([
    displayMenuPromise,
    selectedOrderMenuPromise,
  ]);
  const pickupMenu = view === "pickup" ? selectedOrderMenu : null;
  const deliveryMenu = view === "delivery" ? selectedOrderMenu : null;
  const activeMenu = view === "menu" ? menu : selectedOrderMenu;
  const displayLocale = activeMenu && !activeMenu.supportedLocales.includes(locale)
    ? "zh-TW"
    : locale;
  const pickupReady = stall.orderingSettings?.takeoutPreorderEnabled === true && Boolean(pickupQrToken);
  const deliveryReady = stall.orderingSettings?.deliveryModuleEnabled === true && Boolean(deliveryQrToken);
  const availability = {
    menu: {
      enabled: view === "menu" ? Boolean(menu) : Boolean(stall.orderingSettings),
      reason: publicMessages.get(displayLocale, "storefrontMenuUnavailable"),
    },
    pickup: {
      enabled: pickupReady && (view !== "pickup" || Boolean(pickupMenu)),
      reason: unavailableReason(displayLocale, "pickup", stall.name, {
        moduleEnabled: stall.orderingSettings?.takeoutPreorderEnabled === true,
        hasQr: Boolean(pickupQrToken),
      }),
    },
    delivery: {
      enabled: deliveryReady && (view !== "delivery" || Boolean(deliveryMenu)),
      reason: unavailableReason(displayLocale, "delivery", stall.name, {
        moduleEnabled: stall.orderingSettings?.deliveryModuleEnabled === true,
        hasQr: Boolean(deliveryQrToken),
      }),
    },
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950">
      <StorefrontModeNav
        identifier={resolution.canonicalIdentifier}
        currentView={view}
        availability={availability}
        searchParams={query}
        locale={displayLocale}
      />
      {view === "menu" && menu ? <PublicMenuView menu={menu} locale={displayLocale} /> : null}
      {view === "pickup" && pickupMenu && pickupQrToken ? (
        <QrOrderFlow
          qrToken={pickupQrToken}
          orderingMode="PREORDER"
          initialMenu={pickupMenu}
          entryChannel="SHARED_LINK"
          initialUiLocale={displayLocale}
          requestedLocale={requestedLocale}
          editTrackingToken={editTrackingToken}
        />
      ) : null}
      {view === "delivery" && deliveryMenu && deliveryQrToken ? (
        <QrOrderFlow
          qrToken={deliveryQrToken}
          orderingMode="DELIVERY"
          initialMenu={deliveryMenu}
          entryChannel="SHARED_LINK"
          initialUiLocale={displayLocale}
          requestedLocale={requestedLocale}
          editTrackingToken={editTrackingToken}
        />
      ) : null}
      {!availability[view].enabled ? (
        <UnavailableMode locale={displayLocale} stallName={stall.name} view={view} reason={availability[view].reason} />
      ) : null}
      {view === "pickup" ? <PickupScheduleLink locale={displayLocale} identifier={resolution.canonicalIdentifier} /> : null}
    </div>
  );
}

function PickupScheduleLink({ locale, identifier }: { locale: AppLocale; identifier: string }) {
  return (
    <footer data-testid="storefront-pickup-schedule-link" className="mx-auto max-w-5xl px-4 pb-8 md:px-8">
      <Link
        href={`/s/${encodeURIComponent(identifier)}/schedule?locale=${locale}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-800"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        {publicMessages.get(locale, "storefrontPickupSchedule")}
      </Link>
    </footer>
  );
}

function UnavailableMode({
  locale,
  stallName,
  view,
  reason,
}: {
  locale: AppLocale;
  stallName: string;
  view: PublicStorefrontView;
  reason: string;
}) {
  const title = view === "pickup"
    ? publicMessages.get(locale, "storefrontPickupUnavailableTitle")
    : view === "delivery"
      ? publicMessages.get(locale, "storefrontDeliveryUnavailableTitle")
      : publicMessages.get(locale, "storefrontMenuUnavailableTitle");
  return (
    <main data-testid="storefront-mode-unavailable" className="mx-auto min-h-[60vh] max-w-lg px-5 py-16">
      <ShieldCheck className="h-9 w-9 text-red-700" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">{stallName}：{reason}</p>
    </main>
  );
}

function unavailableReason(
  locale: AppLocale,
  view: "pickup" | "delivery",
  stallName: string,
  state: { moduleEnabled: boolean; hasQr: boolean },
) {
  if (!state.moduleEnabled) {
    return view === "pickup"
      ? publicMessages.get(locale, "storefrontPickupDisabled", { stallName })
      : publicMessages.get(locale, "storefrontDeliveryDisabled", { stallName });
  }
  if (!state.hasQr) return publicMessages.get(locale, "storefrontQrMissing");
  return view === "pickup"
    ? publicMessages.get(locale, "storefrontPickupTemporarilyUnavailable")
    : publicMessages.get(locale, "storefrontDeliveryTemporarilyUnavailable");
}

function resolveStorefrontLocale(
  query: PublicStorefrontSearchParams,
  fallbackLocale: AppLocale,
) {
  const rawLocale = Array.isArray(query.locale) ? query.locale[0] : query.locale;
  const requestedLocale = isAppLocale(rawLocale) ? rawLocale : null;
  return {
    locale: requestedLocale ?? fallbackLocale,
    requestedLocale,
  };
}

function storefrontViewLabel(locale: AppLocale, view: PublicStorefrontView) {
  return publicMessages.get(
    locale,
    view === "pickup"
      ? "storefrontPickup"
      : view === "delivery"
        ? "storefrontDelivery"
        : "storefrontMenu",
  );
}

function resolveEditTrackingToken(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9_-]{40,200}$/.test(candidate) ? candidate : null;
}
