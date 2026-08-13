import { QrOrderFlow } from "@/components/qr-order-flow";
import { isAppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { getCachedPublicMenuForQrToken } from "@/lib/public-menu";
import { createRequestId } from "@/lib/security";

type PageProps = {
  params: Promise<{ qrToken: string }>;
  searchParams?: Promise<{ locale?: string | string[] }>;
};

export default async function QrOrderPage({ params, searchParams }: PageProps) {
  const timing = createPerformanceTiming({
    route: "/q/:qrToken",
    requestId: createRequestId(),
  });
  const renderStartedAt = timing.start();
  const [{ qrToken }, query, requestLocale] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ locale?: string | string[] }>({}),
    getRequestAppLocale(),
  ]);
  const queryLocale = Array.isArray(query.locale) ? query.locale[0] : query.locale;
  const requestedLocale = isAppLocale(queryLocale) ? queryLocale : null;
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
    <QrOrderFlow
      qrToken={qrToken}
      orderingMode={initialMenu?.orderingMode ?? "DEFAULT"}
      initialMenu={initialMenu}
      entryChannel="QR"
      initialUiLocale={requestLocale.locale}
      requestedLocale={requestedLocale}
    />
  );
}
