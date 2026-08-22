import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { planLabel } from "@/lib/billing-labels";
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
      <div data-testid="admin-plan-versions-mobile-list" className="mt-6 grid gap-3 md:hidden">
        {versions.map((version) => (
          <article key={version.id} className="min-w-0 rounded-md border border-stone-200 bg-white p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h2 className="min-w-0 break-words text-lg font-semibold">{planLabel(version.plan.code, version.displayName)}</h2>
              <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">v{formatAppNumber(locale, version.version)}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <MobileDetail label={m("Interval")} value={getAdminCodeLabel(locale, version.billingInterval)} />
              <MobileDetail label={m("Pricing mode")} value={version.pricingMode === "USAGE_PER_STALL_CAPPED" ? m("PAYG per completed order") : version.pricingMode === "FIXED" ? m("Fixed monthly price") : getAdminCodeLabel(locale, version.pricingMode)} />
              {version.pricingMode === "USAGE_PER_STALL_CAPPED" ? (
                <>
                  <MobileDetail label={m("Usage unit price")} value={formatAppCurrency(locale, version.usageUnitPrice, version.currency)} />
                  <MobileDetail label={m("Per-stall monthly cap")} value={version.monthlyCapAmount === null ? m("Per contract") : formatAppCurrency(locale, version.monthlyCapAmount, version.currency)} />
                </>
              ) : (
                <>
                  <MobileDetail label={m("Monthly fee")} value={formatAppCurrency(locale, version.basePrice, version.currency)} />
                  <MobileDetail label={m("Annual fee")} value={version.annualPrice === null ? "-" : formatAppCurrency(locale, version.annualPrice, version.currency)} />
                </>
              )}
              <MobileDetail label={m("Order allowance")} value={version.includedOrders === null ? m("Per contract") : formatAppNumber(locale, version.includedOrders)} />
              <MobileDetail label={m("Stalls")} value={`${formatAppNumber(locale, version.includedStalls)} / ${version.maxStalls === null ? m("Per contract") : formatAppNumber(locale, version.maxStalls)}`} />
              <MobileDetail label={m("Effective from")} value={formatAppDate(locale, version.effectiveFrom)} />
              <MobileDetail label={m("Subscriptions")} value={formatAppNumber(locale, version._count.subscriptions)} />
            </dl>
          </article>
        ))}
      </div>
      <div data-testid="admin-plan-versions-desktop-table" className="mt-6 hidden overflow-x-auto border-y border-stone-200 md:block">
        <table className="w-full min-w-[1240px] text-left text-sm">
          <thead className="bg-stone-50"><tr><th className="px-3 py-3">{m("Plan")}</th><th className="px-3 py-3">{m("Plan version")}</th><th className="px-3 py-3">{m("Interval")}</th><th className="px-3 py-3">{m("Pricing mode")}</th><th className="px-3 py-3 text-right">{m("Monthly fee")}</th><th className="px-3 py-3 text-right">{m("Annual fee")}</th><th className="px-3 py-3 text-right">{m("Usage unit price")}</th><th className="px-3 py-3 text-right">{m("Per-stall monthly cap")}</th><th className="px-3 py-3 text-right">{m("Order allowance")}</th><th className="px-3 py-3 text-right">{m("Stalls")}</th><th className="px-3 py-3">{m("Effective from")}</th><th className="px-3 py-3 text-right">{m("Subscriptions")}</th></tr></thead>
          <tbody className="divide-y divide-stone-200">
            {versions.map((version) => (
              <tr key={version.id}>
                <td className="px-3 py-4 font-semibold">{planLabel(version.plan.code, version.displayName)}</td>
                <td className="px-3 py-4">v{formatAppNumber(locale, version.version)}</td>
                <td className="px-3 py-4">{getAdminCodeLabel(locale, version.billingInterval)}</td>
                <td className="px-3 py-4">{version.pricingMode === "USAGE_PER_STALL_CAPPED" ? m("PAYG per completed order") : version.pricingMode === "FIXED" ? m("Fixed monthly price") : getAdminCodeLabel(locale, version.pricingMode)}</td>
                <td className="px-3 py-4 text-right">{version.pricingMode === "USAGE_PER_STALL_CAPPED" ? "-" : formatAppCurrency(locale, version.basePrice, version.currency)}</td>
                <td className="px-3 py-4 text-right">{version.pricingMode === "USAGE_PER_STALL_CAPPED" || version.annualPrice === null ? "-" : formatAppCurrency(locale, version.annualPrice, version.currency)}</td>
                <td className="px-3 py-4 text-right">{version.pricingMode === "USAGE_PER_STALL_CAPPED" ? formatAppCurrency(locale, version.usageUnitPrice, version.currency) : "-"}</td>
                <td className="px-3 py-4 text-right">{version.pricingMode === "USAGE_PER_STALL_CAPPED" ? version.monthlyCapAmount === null ? m("Per contract") : formatAppCurrency(locale, version.monthlyCapAmount, version.currency) : "-"}</td>
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

function MobileDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>;
}
