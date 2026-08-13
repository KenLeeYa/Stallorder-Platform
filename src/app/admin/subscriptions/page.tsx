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
      <div className="mt-6 overflow-x-auto border-y border-stone-200">
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
                <td className="px-3 py-4 text-right"><Link href={`/admin/subscriptions/${subscription.id}`} className="font-semibold text-teal-800">{m("Manage")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {subscriptions.length === 0 ? <p className="px-3 py-8 text-sm text-stone-500">{m("There are no subscriptions.")}</p> : null}
      </div>
    </main>
  );
}
