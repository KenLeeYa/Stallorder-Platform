import { QrOrderFlow } from "@/components/qr-order-flow";
import { getCachedPublicMenuForQrToken } from "@/lib/public-menu";

type PageProps = { params: Promise<{ qrToken: string }> };

export default async function QrOrderPage({ params }: PageProps) {
  const { qrToken } = await params;
  const initialMenu = await getCachedPublicMenuForQrToken(qrToken);
  return <QrOrderFlow qrToken={qrToken} initialMenu={initialMenu} />;
}
