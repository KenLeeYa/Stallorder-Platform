import Link from "next/link";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { QrOrderFlow } from "@/components/qr-order-flow";
import { prisma } from "@/lib/prisma";
import { getCachedPublicMenuForQrToken } from "@/lib/public-menu";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function SharedTakeoutOrderPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const stall = await prisma.stall.findFirst({
    where: {
      slug: stallSlug,
      isActive: true,
      organization: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    },
    select: {
      name: true,
      slug: true,
      orderingSettings: { select: { takeoutPreorderEnabled: true } },
      qrCodes: {
        where: {
          diningTableId: null,
          marketEventId: null,
          stallScheduleId: null,
          state: "ACTIVE",
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            { OR: [{ fulfillmentTypeContext: null }, { fulfillmentTypeContext: "TAKEOUT" }] },
          ],
        },
        orderBy: [{ tokenVersion: "desc" }, { updatedAt: "desc" }],
        take: 1,
        select: { token: true },
      },
    },
  });
  if (!stall) notFound();

  const qrToken = stall.qrCodes[0]?.token;
  const initialMenu = stall.orderingSettings?.takeoutPreorderEnabled && qrToken
    ? await getCachedPublicMenuForQrToken(qrToken, "PREORDER")
    : null;

  if (!qrToken || !initialMenu) {
    return (
      <main className="mx-auto min-h-screen max-w-lg px-5 py-16">
        <ShieldCheck className="h-9 w-9 text-red-700" />
        <h1 className="mt-4 text-2xl font-semibold">目前未開放預約外帶</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {stall.name} 目前沒有可接受的預約取餐時段，請稍後再試或直接聯絡店家。
        </p>
        <Link href={`/s/${stall.slug}/schedule`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold text-teal-800"><CalendarDays className="h-4 w-4" />查看出攤行程</Link>
      </main>
    );
  }

  return (
    <>
      <QrOrderFlow
        qrToken={qrToken}
        orderingMode="PREORDER"
        initialMenu={initialMenu}
        entryChannel="SHARED_LINK"
      />
      <footer className="mx-auto max-w-5xl px-4 pb-8 md:px-8">
        <Link href={`/s/${stall.slug}/schedule`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-800"><CalendarDays className="h-4 w-4" />查看出攤行程</Link>
      </footer>
    </>
  );
}
