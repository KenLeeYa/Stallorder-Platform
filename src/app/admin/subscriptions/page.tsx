import Link from "next/link";
import { getAdminSubscriptions } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";

export default async function AdminSubscriptionsPage() {
  const [{ locale }, subscriptions] = await Promise.all([getRequestAppLocale(), getAdminSubscriptions()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">{m("Subscription management")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("Review plan versions, status, periods, and recent reconciled usage.")}</p>
      </header>
      <div data-testid="admin-subscriptions-mobile-list" className="mt-6 grid gap-3 md:hidden">
        {subscriptions.map((subscription) => (
          <article key={subscription.id} className="min-w-0 rounded-md border border-stone-200 bg-white p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h2 className="min-w-0 break-words text-lg font-semibold">{subscription.organization.businessName}</h2>
              <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{getAdminCodeLabel(locale, subscription.status)}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <MobileDetail label={m("Plan version")} value={`${subscription.planVersion.displayName} v${formatAppNumber(locale, subscription.planVersion.version)}`} />
              <MobileDetail label={m("Reconciled orders")} value={formatAppNumber(locale, subscription.organization.billingUsageSummaries[0]?.billableOrderCount ?? 0)} />
              <div className="col-span-2 min-w-0">
                <dt className="text-xs font-semibold text-stone-500">{m("Billing period")}</dt>
                <dd className="mt-1 break-words">{m("{start} to {end}", { start: formatAppDate(locale, subscription.billingPeriodStart), end: formatAppDate(locale, subscription.billingPeriodEnd) })}</dd>
              </div>
            </dl>
            <Link href={`/admin/subscriptions/${subscription.id}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800">{m("Manage")}</Link>
          </article>
        ))}
      </div>
      <div data-testid="admin-subscriptions-desktop-table" className="mt-6 hidden overflow-x-auto border-y border-stone-200 md:block">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr>
              <th className="px-3 py-3">{m("Merchant")}</th>
              <th className="px-3 py-3">{m("Plan version")}</th>
              <th className="px-3 py-3">{m("Status")}</th>
              <th className="px-3 py-3">{m("Billing period")}</th>
              <th className="px-3 py-3 text-right">{m("Reconciled orders")}</th>
              <th className="px-3 py-3 text-right">{m("Manage")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {subscriptions.map((subscription) => (
              <tr key={subscription.id}>
                <td className="px-3 py-4 font-semibold">{subscription.organization.businessName}</td>
                <td className="px-3 py-4">{subscription.planVersion.displayName} v{formatAppNumber(locale, subscription.planVersion.version)}</td>
                <td className="px-3 py-4">{getAdminCodeLabel(locale, subscription.status)}</td>
                <td className="px-3 py-4">{m("{start} to {end}", { start: formatAppDate(locale, subscription.billingPeriodStart), end: formatAppDate(locale, subscription.billingPeriodEnd) })}</td>
                <td className="px-3 py-4 text-right">{formatAppNumber(locale, subscription.organization.billingUsageSummaries[0]?.billableOrderCount ?? 0)}</td>
                <td className="px-3 py-4 text-right"><Link href={`/admin/subscriptions/${subscription.id}`} className="inline-flex min-h-11 items-center font-semibold text-teal-800">{m("Manage")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {subscriptions.length === 0 ? <p className="mt-6 border-y border-stone-200 px-3 py-8 text-sm text-stone-500">{m("There are no subscriptions.")}</p> : null}
    </main>
  );
}

function MobileDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>;
}
