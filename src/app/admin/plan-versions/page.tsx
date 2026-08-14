import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";

export default async function AdminPlanVersionsPage() {
  const [{ locale }, { versions }] = await Promise.all([getRequestAppLocale(), getAdminPlanCatalog()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">{m("Plan versions")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("This is a read-only catalog. New versions require a controlled migration and audit workflow.")}</p>
        <AdminCatalogNavigation />
      </header>
      <div className="mt-6 overflow-x-auto border-y border-stone-200">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-stone-50"><tr><th className="px-3 py-3">{m("Plan")}</th><th className="px-3 py-3">{m("Plan version")}</th><th className="px-3 py-3">{m("Interval")}</th><th className="px-3 py-3 text-right">{m("Monthly fee")}</th><th className="px-3 py-3 text-right">{m("Annual fee")}</th><th className="px-3 py-3 text-right">{m("Order allowance")}</th><th className="px-3 py-3 text-right">{m("Stalls")}</th><th className="px-3 py-3">{m("Effective from")}</th><th className="px-3 py-3 text-right">{m("Subscriptions")}</th></tr></thead>
          <tbody className="divide-y divide-stone-200">
            {versions.map((version) => (
              <tr key={version.id}>
                <td className="px-3 py-4 font-semibold">{version.displayName}</td>
                <td className="px-3 py-4">v{formatAppNumber(locale, version.version)}</td>
                <td className="px-3 py-4">{getAdminCodeLabel(locale, version.billingInterval)}</td>
                <td className="px-3 py-4 text-right">{formatAppCurrency(locale, version.basePrice, version.currency)}</td>
                <td className="px-3 py-4 text-right">{version.annualPrice === null ? "-" : formatAppCurrency(locale, version.annualPrice, version.currency)}</td>
                <td className="px-3 py-4 text-right">{version.includedOrders === null ? m("Per contract") : formatAppNumber(locale, version.includedOrders)}</td>
                <td className="px-3 py-4 text-right">{formatAppNumber(locale, version.includedStalls)} / {version.maxStalls === null ? m("Per contract") : formatAppNumber(locale, version.maxStalls)}</td>
                <td className="px-3 py-4">{formatAppDate(locale, version.effectiveFrom)}</td>
                <td className="px-3 py-4 text-right">{formatAppNumber(locale, version._count.subscriptions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
