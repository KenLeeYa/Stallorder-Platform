import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { AdminDeliveryRequestActions } from "@/components/admin-delivery-integration-actions";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { deliveryProviderLabel } from "@/lib/delivery-platform-labels";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";
import { prisma } from "@/lib/prisma";
import { requireAdminModuleVisible } from "@/server/admin/admin-module-visibility";

type PageProps = { params: Promise<{ requestId: string }> };

export default async function AdminDeliveryRequestPage({ params }: PageProps) {
  await requirePlatformAdminPage("/admin/delivery-integrations");
  await requireAdminModuleVisible("delivery");
  const [{ requestId }, { locale }] = await Promise.all([params, getRequestAppLocale()]);
  const request = await prisma.deliveryPlatformConnectionRequest.findUnique({
    where: { id: requestId },
    select: { id: true, provider: true, merchantContactName: true, merchantContactEmail: true, merchantContactPhone: true, externalVendorCode: true, externalChainCode: true, currentProvider: true, requestedCapabilitiesJson: true, status: true, merchantNote: true, adminNote: true, submittedAt: true, reviewedAt: true, organizationId: true, stallId: true },
  });
  if (!request) notFound();
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <Link href="/admin/delivery-integrations" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />{m("Back to delivery integration management")}</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{deliveryProviderLabel(request.provider)}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><ClipboardCheck className="h-7 w-7 text-teal-700" />{m("Connection request review")}</h1><p className="mt-2 text-sm text-stone-600">{getAdminCodeLabel(locale, request.status)}</p></header>
      <dl className="grid gap-x-8 gap-y-5 py-7 sm:grid-cols-2">
        <Field label={m("Contact")} value={request.merchantContactName} fallback={m("Not provided")} />
        <Field label={m("Email")} value={request.merchantContactEmail} fallback={m("Not provided")} />
        <Field label={m("Phone")} value={request.merchantContactPhone} fallback={m("Not provided")} />
        <Field label="Vendor Code" value={request.externalVendorCode} fallback={m("Not provided")} />
        <Field label="Chain Code" value={request.externalChainCode} fallback={m("Not provided")} />
        <Field label={m("Current system")} value={request.currentProvider} fallback={m("Not provided")} />
        <Field label={m("Merchant note")} value={request.merchantNote} fallback={m("Not provided")} />
        <Field label={m("Administrator note")} value={request.adminNote} fallback={m("Not provided")} />
      </dl>
      {["SUBMITTED", "NEEDS_INFORMATION"].includes(request.status) ? <section className="border-t border-stone-200 py-6"><AdminDeliveryRequestActions requestId={request.id} /></section> : null}
    </main>
  );
}

function Field({ label, value, fallback }: { label: string; value: string | null; fallback: string }) {
  return <div><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words text-sm text-stone-900">{value || fallback}</dd></div>;
}
