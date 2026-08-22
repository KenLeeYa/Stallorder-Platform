import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { featureLabel, planLabel } from "@/lib/billing-labels";
import { formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator } from "@/lib/messages/admin";

export default async function AdminEntitlementsPage() {
  const [{ locale }, { versions }] = await Promise.all([getRequestAppLocale(), getAdminPlanCatalog()]);
  const m = createAdminTranslator(locale);
  const currentVersions = newestVersions(versions);
  const features = [...new Set(currentVersions.flatMap((version) => version.entitlements.map((item) => item.featureCode)))]
    .sort((left, right) => featureLabel(left).localeCompare(featureLabel(right), "zh-Hant"));

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header><h1 className="text-3xl font-semibold">{m("Feature entitlement matrix")}</h1><p className="mt-2 text-sm text-stone-600">{m("The application uses server-side effective entitlements for every feature decision.")}</p><AdminCatalogNavigation /></header>
      <div data-testid="admin-entitlements-mobile-list" className="mt-6 grid gap-3 md:hidden">
        {features.map((feature) => (
          <article key={feature} className="min-w-0 rounded-md border border-stone-200 bg-white p-4">
            <h2 className="break-words text-lg font-semibold">{featureLabel(feature)}</h2>
            <p className="mt-1 break-all font-mono text-xs text-stone-500">{feature}</p>
            <dl className="mt-4 grid gap-3 text-sm">
              {currentVersions.map((version) => {
                const entitlement = version.entitlements.find((item) => item.featureCode === feature);
                return (
                  <div key={version.id} className="flex min-w-0 items-center justify-between gap-3 border-t border-stone-100 pt-3 first:border-t-0 first:pt-0">
                    <dt className="min-w-0 break-words text-stone-600">{planLabel(version.plan.code, version.displayName)} v{formatAppNumber(locale, version.version)}</dt>
                    <dd className="shrink-0 font-semibold">{entitlement?.isEnabled ? entitlement.limitValue ?? m("Enabled") : "-"}</dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>
      <div data-testid="admin-entitlements-desktop-table" className="mt-6 hidden overflow-x-auto border-y border-stone-200 md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-stone-50"><tr><th className="sticky left-0 bg-stone-50 px-3 py-3">{m("Feature")}</th>{currentVersions.map((version) => <th key={version.id} className="px-3 py-3 text-center">{planLabel(version.plan.code, version.displayName)} v{formatAppNumber(locale, version.version)}</th>)}</tr></thead>
          <tbody className="divide-y divide-stone-200">
            {features.map((feature) => (
              <tr key={feature}>
                <td className="sticky left-0 bg-white px-3 py-3"><strong>{featureLabel(feature)}</strong><div className="font-mono text-xs text-stone-500">{feature}</div></td>
                {currentVersions.map((version) => {
                  const entitlement = version.entitlements.find((item) => item.featureCode === feature);
                  return <td key={version.id} className="px-3 py-3 text-center">{entitlement?.isEnabled ? entitlement.limitValue ?? m("Enabled") : "-"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function newestVersions<T extends { planId: string; version: number }>(versions: T[]) {
  const map = new Map<string, T>();
  for (const version of versions) {
    if (!map.has(version.planId) || (map.get(version.planId)?.version ?? 0) < version.version) map.set(version.planId, version);
  }
  return [...map.values()].sort((a, b) => a.version - b.version);
}
