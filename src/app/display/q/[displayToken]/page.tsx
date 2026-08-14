import type { Metadata } from "next";
import { PickupDisplayBoard } from "@/components/pickup-display-board";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getOperationsMessage } from "@/lib/messages/operations";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getRequestAppLocale();
  return {
    title: `${getOperationsMessage(locale, "pickup.title")} | StallOrder`,
    robots: { index: false, follow: false },
  };
}

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
