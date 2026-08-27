import type { Metadata } from "next";
import { LazyPickupDisplayBoard } from "@/components/lazy-pickup-display-board";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getOperationsMessage } from "@/lib/messages/operations";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getRequestAppLocale();
  return {
    title: `${getOperationsMessage(locale, "pickup.title")} | StallOrder`,
    robots: { index: false, follow: false },
  };
}

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function PickupDisplayPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const encodedSlug = encodeURIComponent(stallSlug);
  return (
    <LazyPickupDisplayBoard
      dataEndpoint={`/api/public/display/${encodedSlug}`}
      streamEndpoint={`/api/public/display/${encodedSlug}/stream`}
    />
  );
}
