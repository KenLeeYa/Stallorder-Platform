import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { AdminDeliveryRequestActions } from "@/components/admin-delivery-integration-actions";
import { requirePlatformAdminPage } from "@/lib/authorization";
import {
  deliveryProviderLabel,
  deliveryRequestStatusLabels,
} from "@/lib/delivery-platform-labels";
import { prisma } from "@/lib/prisma";

type PageProps = { params: Promise<{ requestId: string }> };

export default async function AdminDeliveryRequestPage({ params }: PageProps) {
  await requirePlatformAdminPage("/admin/delivery-integrations");
  const { requestId } = await params;
  const request = await prisma.deliveryPlatformConnectionRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      provider: true,
      merchantContactName: true,
      merchantContactEmail: true,
      merchantContactPhone: true,
      externalVendorCode: true,
      externalChainCode: true,
      currentProvider: true,
      requestedCapabilitiesJson: true,
      status: true,
      merchantNote: true,
      adminNote: true,
      submittedAt: true,
      reviewedAt: true,
      organizationId: true,
      stallId: true,
    },
  });
  if (!request) notFound();
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <Link href="/admin/delivery-integrations" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回外送整合管理</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{deliveryProviderLabel(request.provider)}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><ClipboardCheck className="h-7 w-7 text-teal-700" />連線申請審核</h1><p className="mt-2 text-sm text-stone-600">{deliveryRequestStatusLabels[request.status] ?? request.status}</p></header>
      <dl className="grid gap-x-8 gap-y-5 py-7 sm:grid-cols-2">
        <Field label="聯絡人" value={request.merchantContactName} />
        <Field label="電子郵件" value={request.merchantContactEmail} />
        <Field label="電話" value={request.merchantContactPhone} />
        <Field label="Vendor Code" value={request.externalVendorCode} />
        <Field label="Chain Code" value={request.externalChainCode} />
        <Field label="現有系統" value={request.currentProvider} />
        <Field label="商家說明" value={request.merchantNote} />
        <Field label="管理員備註" value={request.adminNote} />
      </dl>
      {["SUBMITTED", "NEEDS_INFORMATION"].includes(request.status) ? <section className="border-t border-stone-200 py-6"><AdminDeliveryRequestActions requestId={request.id} /></section> : null}
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words text-sm text-stone-900">{value || "未提供"}</dd></div>;
}
