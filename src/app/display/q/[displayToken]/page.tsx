import type { Metadata } from "next";
import { PickupDisplayBoard } from "@/components/pickup-display-board";

export const metadata: Metadata = {
  title: "取餐顯示 | StallOrder",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ displayToken: string }> };

export default async function TokenizedPickupDisplayPage({ params }: PageProps) {
  const { displayToken } = await params;
  const encodedToken = encodeURIComponent(displayToken);
  return (
    <PickupDisplayBoard
      dataEndpoint={`/api/public/display/q/${encodedToken}`}
      streamEndpoint={`/api/public/display/q/${encodedToken}/stream`}
    />
  );
}
