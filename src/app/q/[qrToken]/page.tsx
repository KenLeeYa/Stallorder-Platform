import { QrOrderFlow } from "@/components/qr-order-flow";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { createRequestId } from "@/lib/security";

type PageProps = { params: Promise<{ qrToken: string }> };

export default async function QrOrderPage({ params }: PageProps) {
  const timing = createPerformanceTiming({
    route: "/q/:qrToken",
    requestId: createRequestId(),
  });
  const renderStartedAt = timing.start();
  const { qrToken } = await params;
  timing.addSince("renderMs", renderStartedAt);
  timing.finish({ status: 200 });
  return <QrOrderFlow qrToken={qrToken} />;
}
