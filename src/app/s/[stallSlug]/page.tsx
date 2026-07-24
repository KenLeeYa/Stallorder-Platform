import Link from "next/link";
import { CalendarDays, QrCode } from "lucide-react";
import { getStallBySlug } from "@/lib/tenant";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function LegacyCustomerPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const stall = await getStallBySlug(stallSlug);

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 py-16">
      <QrCode className="h-9 w-9 text-teal-700" />
      <h1 className="mt-4 text-3xl font-semibold">{stall.name}</h1>
      <p className="mt-4 text-sm leading-6 text-stone-600">
        為保障點餐安全，請掃描攤位現場的 QR Code 建立限時點餐工作階段。
      </p>
      <Link href={`/s/${stall.slug}/schedule`} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold text-teal-800"><CalendarDays className="h-4 w-4" />查看出攤行程</Link>
    </main>
  );
}
