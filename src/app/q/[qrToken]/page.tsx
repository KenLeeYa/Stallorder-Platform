import { LazyQrOrderFlow } from "@/components/lazy-qr-order-flow";
import { isAppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { getCachedPublicMenuForQrToken } from "@/lib/public-menu";
import { createRequestId } from "@/lib/security";

type PageProps = {
  params: Promise<{ qrToken: string }>;
  searchParams?: Promise<{
    locale?: string | string[];
    editOrder?: string | string[];
    newOrder?: string | string[];
  }>;
};

export default async function QrOrderPage({ params, searchParams }: PageProps) {
  const timing = createPerformanceTiming({
    route: "/q/:qrToken",
    requestId: createRequestId(),
  });
  const renderStartedAt = timing.start();
  const [{ qrToken }, query, requestLocale] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{
      locale?: string | string[];
      editOrder?: string | string[];
      newOrder?: string | string[];
    }>({}),
    getRequestAppLocale(),
  ]);
  const queryLocale = Array.isArray(query.locale) ? query.locale[0] : query.locale;
  const requestedLocale = isAppLocale(queryLocale) ? queryLocale : null;
  const rawEditTrackingToken = Array.isArray(query.editOrder)
    ? query.editOrder[0]
    : query.editOrder;
  const editTrackingToken = rawEditTrackingToken
    && /^[A-Za-z0-9_-]{40,200}$/.test(rawEditTrackingToken)
    ? rawEditTrackingToken
    : null;
  const rawNewOrder = Array.isArray(query.newOrder) ? query.newOrder[0] : query.newOrder;
  const startNewOrder = rawNewOrder === "1";
  const initialMenu = await timing.measureDb(
    () => getCachedPublicMenuForQrToken(
      qrToken,
      "DEFAULT",
      { includeOptionalPreorderSlots: false },
    ),
    0,
  );
  timing.addSince("renderMs", renderStartedAt);
  timing.finish({ status: 200 });
  return (
    <LazyQrOrderFlow
      qrToken={qrToken}
      orderingMode={initialMenu?.orderingMode ?? "DEFAULT"}
      initialMenu={initialMenu}
      entryChannel="QR"
      initialUiLocale={requestLocale.locale}
      requestedLocale={requestedLocale}
      editTrackingToken={editTrackingToken}
      startNewOrder={startNewOrder}
      customerMembershipPreview={process.env.NODE_ENV !== "production"}
    />
  );
}
