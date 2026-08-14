import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";

export default async function AdminAddOnsPage() {
  const [{ locale }, { addOns }] = await Promise.all([getRequestAppLocale(), getAdminPlanCatalog()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <header><h1 className="text-3xl font-semibold">{m("Add-on catalog")}</h1><p className="mt-2 text-sm text-stone-600">{m("Only enabled or manually approved items can be added to invoices. Coming-soon items are not activated.")}</p><AdminCatalogNavigation /></header>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {addOns.map((item) => (
          <article key={item.id} className="rounded-md border border-stone-200 p-5">
            <div className="flex justify-between gap-3"><h2 className="font-semibold">{item.displayName}</h2><span className="text-xs">{getAdminCodeLabel(locale, item.availabilityStatus)}</span></div>
            <p className="mt-2 text-sm text-stone-600">{item.description}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label={m("Code")} value={item.code} />
              <Row label={m("Billing type")} value={getAdminCodeLabel(locale, item.billingType)} />
              <Row label={m("Unit price")} value={formatAppCurrency(locale, item.unitPrice, item.currency)} />
              <Row label={m("Entitlement")} value={item.featureCode ?? "-"} />
              <Row label={m("Manual approval")} value={m(item.requiresManualApproval ? "Yes" : "No")} />
            </dl>
          </article>
        ))}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-stone-500">{label}</dt><dd className="break-all text-right">{value}</dd></div>;
}
