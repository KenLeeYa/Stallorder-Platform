import type { Metadata } from "next";
import { cache } from "react";
import { CalendarDays, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { QrOrderFlow } from "@/components/qr-order-flow";
import { getCachedPublicDisplayMenuForStallSlug, getCachedPublicMenuForQrToken } from "@/lib/public-menu";
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
  const [{ identifier }, query] = await Promise.all([params, searchParams]);
  const resolution = await getStorefront(identifier);
  if (!resolution) return { title: "找不到公開菜單", robots: { index: false, follow: false } };

  const view = resolvePublicStorefrontView(query.view);
  const viewLabel = view === "pickup" ? "外帶自取" : view === "delivery" ? "外送" : "公開菜單";
  const title = `${resolution.stall.name}｜${viewLabel}`;
  const description = view === "menu"
    ? `查看 ${resolution.stall.name} 最新上架的商品、套餐與售價。菜單內容由商家即時更新。`
    : `前往 ${resolution.stall.name} 的${viewLabel}服務。`;
  return {
    title,
    description,
    alternates: { canonical: buildPublicStorefrontPath(resolution.canonicalIdentifier) },
    robots: view === "menu" ? undefined : { index: false, follow: false },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "攤點通",
    },
  };
}

export default async function PublicStorefrontPage({ params, searchParams }: PageProps) {
  const [{ identifier }, query] = await Promise.all([params, searchParams]);
  const resolution = await getStorefront(identifier);
  if (!resolution) notFound();

  const view = resolvePublicStorefrontView(query.view);
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
    ? getCachedPublicDisplayMenuForStallSlug(stall.slug)
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
  const pickupReady = stall.orderingSettings?.takeoutPreorderEnabled === true && Boolean(pickupQrToken);
  const deliveryReady = stall.orderingSettings?.deliveryModuleEnabled === true && Boolean(deliveryQrToken);
  const availability = {
    menu: {
      enabled: view === "menu" ? Boolean(menu) : Boolean(stall.orderingSettings),
      reason: "商家目前沒有可顯示的線上 Menu。",
    },
    pickup: {
      enabled: pickupReady && (view !== "pickup" || Boolean(pickupMenu)),
      reason: unavailableReason("pickup", stall.name, {
        moduleEnabled: stall.orderingSettings?.takeoutPreorderEnabled === true,
        hasQr: Boolean(pickupQrToken),
      }),
    },
    delivery: {
      enabled: deliveryReady && (view !== "delivery" || Boolean(deliveryMenu)),
      reason: unavailableReason("delivery", stall.name, {
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
      />
      {view === "menu" && menu ? <PublicMenuView menu={menu} /> : null}
      {view === "pickup" && pickupMenu && pickupQrToken ? (
        <QrOrderFlow
          qrToken={pickupQrToken}
          orderingMode="PREORDER"
          initialMenu={pickupMenu}
          entryChannel="SHARED_LINK"
        />
      ) : null}
      {view === "delivery" && deliveryMenu && deliveryQrToken ? (
        <QrOrderFlow
          qrToken={deliveryQrToken}
          orderingMode="DELIVERY"
          initialMenu={deliveryMenu}
          entryChannel="SHARED_LINK"
        />
      ) : null}
      {!availability[view].enabled ? (
        <UnavailableMode stallName={stall.name} view={view} reason={availability[view].reason} />
      ) : null}
      {view === "pickup" ? <PickupScheduleLink stallSlug={stall.slug} /> : null}
    </div>
  );
}

function PickupScheduleLink({ stallSlug }: { stallSlug: string }) {
  return (
    <footer data-testid="storefront-pickup-schedule-link" className="mx-auto max-w-5xl px-4 pb-8 md:px-8">
      <Link
        href={`/s/${encodeURIComponent(stallSlug)}/schedule`}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-800"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        查看出攤行程
      </Link>
    </footer>
  );
}

function UnavailableMode({
  stallName,
  view,
  reason,
}: {
  stallName: string;
  view: PublicStorefrontView;
  reason: string;
}) {
  const title = view === "pickup"
    ? "目前未開放外帶自取"
    : view === "delivery"
      ? "目前未開放外送"
      : "目前無法顯示線上 Menu";
  return (
    <main data-testid="storefront-mode-unavailable" className="mx-auto min-h-[60vh] max-w-lg px-5 py-16">
      <ShieldCheck className="h-9 w-9 text-red-700" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">{stallName}：{reason}</p>
    </main>
  );
}

function unavailableReason(
  view: "pickup" | "delivery",
  stallName: string,
  state: { moduleEnabled: boolean; hasQr: boolean },
) {
  if (!state.moduleEnabled) {
    return view === "pickup"
      ? `${stallName} 尚未開啟外帶自取服務。`
      : `${stallName} 尚未開啟外送服務。`;
  }
  if (!state.hasQr) return "商家尚未建立可供公開連結使用的 QR Code。";
  return view === "pickup"
    ? "目前沒有可接受的取餐時段，請稍後再試。"
    : "目前無法接受外送訂單，請稍後再試。";
}
