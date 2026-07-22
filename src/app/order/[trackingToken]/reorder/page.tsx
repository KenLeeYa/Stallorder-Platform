import { ReorderReview } from "@/components/reorder-review";

export const metadata = { robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ trackingToken: string }> };

export default async function ReorderPage({ params }: PageProps) {
  const { trackingToken } = await params;
  return <ReorderReview trackingToken={trackingToken} />;
}
