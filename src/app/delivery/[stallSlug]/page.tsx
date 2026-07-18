import { ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { QrOrderFlow } from "@/components/qr-order-flow";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function DeliveryOrderPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const stall = await prisma.stall.findFirst({
    where: {
      slug: stallSlug,
      isActive: true,
      organization: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    },
    select: {
      name: true,
      orderingSettings: { select: { deliveryModuleEnabled: true } },
      qrCodes: {
        where: {
          diningTableId: null,
          state: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ tokenVersion: "desc" }, { updatedAt: "desc" }],
        take: 1,
        select: { token: true },
      },
    },
  });
  if (!stall) notFound();

  const qrToken = stall.qrCodes[0]?.token;
  if (!stall.orderingSettings?.deliveryModuleEnabled || !qrToken) {
    return (
      <main className="mx-auto min-h-screen max-w-lg px-5 py-16">
        <ShieldCheck className="h-9 w-9 text-red-700" />
        <h1 className="mt-4 text-2xl font-semibold">目前未開放線上外送</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {stall.name} 目前無法接受外送訂單，請稍後再試或直接聯絡店家。
        </p>
      </main>
    );
  }

  return <QrOrderFlow qrToken={qrToken} orderingMode="DELIVERY" />;
}
