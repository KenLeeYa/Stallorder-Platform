import { QrOrderFlow } from "@/components/qr-order-flow";

type PageProps = { params: Promise<{ qrToken: string }> };

export default async function QrOrderPage({ params }: PageProps) {
  const { qrToken } = await params;
  return <QrOrderFlow qrToken={qrToken} />;
}
