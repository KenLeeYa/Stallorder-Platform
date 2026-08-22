import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { featureLabel, planLabel } from "@/lib/billing-labels";
import { formatAppCurrency, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator } from "@/lib/messages/admin";

type Catalog = Awaited<ReturnType<typeof getAdminPlanCatalog>>;
type CatalogPlan = Catalog["plans"][number];
type CatalogVersion = Catalog["versions"][number];

const currentPlanCodes = ["TRIAL", "PAYG", "ENTERPRISE"] as const;
const legacyPlanCodes = new Set(["LITE", "STANDARD", "PRO"]);

export default async function AdminPlansPage() {
  const [{ locale }, { plans, versions }] = await Promise.all([getRequestAppLocale(), getAdminPlanCatalog()]);
  const m = createAdminTranslator(locale);
  const latestVersionByPlan = new Map<string, CatalogVersion>();
  for (const version of versions) {
    if (!latestVersionByPlan.has(version.planId)) latestVersionByPlan.set(version.planId, version);
  }
  const currentPlans = currentPlanCodes
    .map((code) => plans.find((plan) => plan.code === code))
    .filter((plan): plan is CatalogPlan => Boolean(plan));
  const legacyPlans = plans.filter((plan) => legacyPlanCodes.has(plan.code));

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">{m("Plan catalog")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("New merchants follow Trial to PAYG. Enterprise remains a manually quoted option.")}</p>
        <AdminCatalogNavigation />
      </header>
      <section className="mt-6">
        <h2 className="text-xl font-semibold">{m("Current commercial path")}</h2>
        <p className="mt-1 text-sm text-stone-600">{m("Only these offerings are available for new onboarding; rollout flags remain server-authoritative.")}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {currentPlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} version={latestVersionByPlan.get(plan.id)} locale={locale} legacy={false} />
          ))}
        </div>
      </section>
      <details className="mt-8 rounded-md border border-stone-200 bg-stone-50 p-4 sm:p-5">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">{m("Historical contracts")}</summary>
        <p className="mt-2 text-sm text-stone-600">{m("Legacy plans are closed to new sales but remain available for existing subscriptions, invoices, and support.")}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {legacyPlans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} version={latestVersionByPlan.get(plan.id)} locale={locale} legacy />
          ))}
        </div>
      </details>
    </main>
  );
}

function PlanCard({ plan, version, locale, legacy }: { plan: CatalogPlan; version?: CatalogVersion; locale: Parameters<typeof formatAppCurrency>[0]; legacy: boolean }) {
  const m = createAdminTranslator(locale);
  const isPayg = plan.code === "PAYG";
  const isTrial = plan.code === "TRIAL";
  const isEnterprise = plan.code === "ENTERPRISE";
  const offered = !legacy && (Boolean(version?.isPublic) || isEnterprise);
  const enabledEntitlements = (version?.entitlements ?? [])
    .filter((entitlement) => entitlement.isEnabled)
    .sort((left, right) => featureLabel(left.featureCode).localeCompare(featureLabel(right.featureCode), "zh-Hant"));

  return (
    <article className={`min-w-0 rounded-lg border p-5 ${isPayg ? "border-teal-300 bg-teal-50/50" : "border-stone-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words text-xl font-semibold">{planLabel(plan.code, plan.displayName)}</h3><p className="mt-1 text-xs text-stone-500">{m("Code {code}", { code: plan.code })}</p></div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${offered ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>{m(offered ? "Available for new onboarding" : legacy ? "Closed to new sales" : "Manual quote")}</span>
      </div>
      <dl className="mt-5 space-y-2 text-sm">
        {isTrial ? <Row label={m("Trial terms")} value={m("{days} days or {count} completed orders", { days: version?.trialDays ?? 14, count: version?.includedOrders ?? 100 })} /> : null}
        {isPayg ? <>
          <Row label={m("Monthly base fee")} value={formatAppCurrency(locale, plan.basePrice)} />
          <Row label={m("Usage unit price")} value={formatAppCurrency(locale, plan.usageUnitPrice)} />
          <Row label={m("Per-stall monthly cap")} value={formatAppCurrency(locale, plan.monthlyCapAmount ?? 0)} />
          <Row label={m("Minimum charge")} value={formatAppCurrency(locale, plan.minimumCharge)} />
        </> : null}
        {isEnterprise ? <Row label={m("Pricing mode")} value={m("Manual quote")} /> : null}
        {!isTrial && !isPayg && !isEnterprise ? <Row label={m("Historical monthly fee")} value={formatAppCurrency(locale, plan.basePrice)} /> : null}
        <Row label={m("Plan versions")} value={formatAppNumber(locale, plan._count.versions)} />
        <Row label={m("Subscriptions")} value={formatAppNumber(locale, plan._count.subscriptions)} />
      </dl>
      {enabledEntitlements.length ? (
        <details className="mt-4 border-t border-stone-200 pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-2 font-semibold">
            <span>{m("Plan entitlements")}</span>
            <span className="text-sm text-stone-500">{formatAppNumber(locale, enabledEntitlements.length)}</span>
          </summary>
          <ul className="grid gap-2 pb-2 text-sm sm:grid-cols-2">
            {enabledEntitlements.map((entitlement) => (
              <li key={entitlement.featureCode} title={entitlement.featureCode} className="min-w-0 break-words rounded-md bg-stone-100 px-3 py-2 text-stone-800">
                {featureLabel(entitlement.featureCode)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {isPayg ? <p className="mt-4 border-t border-teal-200 pt-3 text-sm text-teal-950">{m("Each stall is capped independently; the organization total is the sum of its stall charges.")}</p> : null}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return <div className="flex min-w-0 justify-between gap-3"><dt className="text-stone-500">{label}</dt><dd className="break-words text-right font-medium">{value}</dd></div>;
}
