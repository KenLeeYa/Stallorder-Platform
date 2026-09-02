import { PublicOrderTracker } from "@/components/public-order-tracker";

type PageProps = {
  params: Promise<{ trackingToken: string }>;
  searchParams?: Promise<{ qr?: string | string[] }>;
};

export default async function PublicOrderPage({ params, searchParams }: PageProps) {
  const [{ trackingToken }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ qr?: string | string[] }>({}),
  ]);
  const rawQrToken = Array.isArray(query.qr) ? query.qr[0] : query.qr;
  const qrToken = rawQrToken
    && rawQrToken.trim().length >= 24
    && rawQrToken.length <= 200
    ? rawQrToken
    : null;
  return <PublicOrderTracker trackingToken={trackingToken} qrToken={qrToken} />;
}
