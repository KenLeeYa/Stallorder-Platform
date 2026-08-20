import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator } from "@/lib/messages/admin";

export default async function AdminPlansPage() {
  const [{ locale }, { plans, featureFlags }] = await Promise.all([getRequestAppLocale(), getAdminPlanCatalog()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">{m("Plan catalog")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("Existing subscriptions are pinned to a plan version. Price changes require a new version and never rewrite old contracts.")}</p>
        <AdminCatalogNavigation />
      </header>
      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.id} className="rounded-md border border-stone-200 p-5">
            <div className="flex justify-between gap-3"><h2 className="text-xl font-semibold">{plan.displayName}</h2><span className="text-sm">{m(plan.isActive ? "Active" : "Inactive")}</span></div>
            <p className="mt-2 text-sm text-stone-600">{m("Code {code}", { code: plan.code })}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label={m("Reference monthly fee")} value={formatAppCurrency(locale, plan.basePrice)} />
              <Row label={m("Included stalls")} value={formatAppNumber(locale, plan.includedStalls)} />
              <Row label={m("Maximum stalls")} value={plan.maxStalls === null ? m("Per contract") : formatAppNumber(locale, plan.maxStalls)} />
              <Row label={m("Plan versions")} value={formatAppNumber(locale, plan._count.versions)} />
              <Row label={m("Subscriptions")} value={formatAppNumber(locale, plan._count.subscriptions)} />
            </dl>
          </article>
        ))}
      </section>
      <section className="mt-8 border-y border-stone-200 py-5">
        <h2 className="text-xl font-semibold">{m("Commercial feature flags")}</h2>
        <p className="mt-2 text-sm text-stone-600">{m("Phase 2/3 features remain disabled on the server.")}</p>
        <div className="mt-3 divide-y divide-stone-200">
          {featureFlags.map((flag) => (
            <div key={flag.code} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(260px,1fr)_100px_100px]">
              <strong>{flag.code}</strong>
              <span>{m("Phase {phase}", { phase: flag.phase })}</span>
              <span className={flag.isEnabled ? "text-emerald-700" : "text-stone-500"}>{m(flag.isEnabled ? "Enabled" : "Disabled")}</span>
              <p className="text-stone-600 sm:col-span-3">{flag.description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return <div className="flex justify-between gap-3"><dt className="text-stone-500">{label}</dt><dd>{value}</dd></div>;
}
