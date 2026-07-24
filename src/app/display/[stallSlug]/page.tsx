import type { Metadata } from "next";
import { PickupDisplayBoard } from "@/components/pickup-display-board";

export const metadata: Metadata = {
  title: "取餐顯示 | StallOrder",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function PickupDisplayPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const encodedSlug = encodeURIComponent(stallSlug);
  return (
    <PickupDisplayBoard
      dataEndpoint={`/api/public/display/${encodedSlug}`}
      streamEndpoint={`/api/public/display/${encodedSlug}/stream`}
    />
  );
}
