import { PublicOrderTracker } from "@/components/public-order-tracker";

type PageProps = { params: Promise<{ trackingToken: string }> };

export default async function PublicOrderPage({ params }: PageProps) {
  const { trackingToken } = await params;
  return <PublicOrderTracker trackingToken={trackingToken} />;
}
