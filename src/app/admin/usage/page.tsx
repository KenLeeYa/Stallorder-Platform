import Link from "next/link";
import { getAdminUsage } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppDate, formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator } from "@/lib/messages/admin";

export default async function AdminUsagePage() {
  const [{ locale }, summaries] = await Promise.all([getRequestAppLocale(), getAdminUsage()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">{m("Usage reconciliation")}</h1>
        <p className="mt-2 text-sm text-stone-600">
          {m("Usage summaries can be rebuilt from append-only usage events on the subscription details page. Historical events are never deleted.")}
        </p>
      </header>
      <div className="mt-6 overflow-x-auto border-y border-stone-200">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-stone-50">
            <tr>
              <th className="px-3 py-3">{m("Month")}</th>
              <th className="px-3 py-3">{m("Merchant")}</th>
              <th className="px-3 py-3">{m("Plan")}</th>
              <th className="px-3 py-3 text-right">{m("Billable orders")}</th>
              <th className="px-3 py-3 text-right">{m("Allowance")}</th>
              <th className="px-3 py-3 text-right">{m("Stalls")}</th>
              <th className="px-3 py-3 text-right">{m("Staff")}</th>
              <th className="px-3 py-3 text-right">QR</th>
              <th className="px-3 py-3">{m("Calculated at")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {summaries.map((summary) => {
              const subscription = summary.organization.subscription;
              return (
                <tr key={summary.id}>
                  <td className="px-3 py-4">{formatAppDate(locale, summary.billingPeriod, { year: "numeric", month: "long", timeZone: "Asia/Taipei" })}</td>
                  <td className="px-3 py-4 font-semibold">
                    <Link href={subscription ? `/admin/subscriptions/${subscription.id}` : "/admin/subscriptions"} className="text-teal-800">
                      {summary.organization.businessName}
                    </Link>
                  </td>
                  <td className="px-3 py-4">{subscription?.planVersion.displayName ?? m("No subscription")}</td>
                  <td className="px-3 py-4 text-right">{formatAppNumber(locale, summary.billableOrderCount)}</td>
                  <td className="px-3 py-4 text-right">{subscription?.planVersion.includedOrders == null ? m("Per contract") : formatAppNumber(locale, subscription.planVersion.includedOrders)}</td>
                  <td className="px-3 py-4 text-right">{formatAppNumber(locale, summary.activeStallCount)}</td>
                  <td className="px-3 py-4 text-right">{formatAppNumber(locale, summary.activeStaffCount)}</td>
                  <td className="px-3 py-4 text-right">{formatAppNumber(locale, summary.qrCodeCount)}</td>
                  <td className="px-3 py-4">{formatAppDateTime(locale, summary.calculatedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {summaries.length === 0 ? <p className="px-3 py-8 text-sm text-stone-500">{m("There are no usage summaries.")}</p> : null}
      </div>
    </main>
  );
}
