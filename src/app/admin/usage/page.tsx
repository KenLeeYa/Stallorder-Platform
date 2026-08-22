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
      <div data-testid="admin-usage-mobile-list" className="mt-6 grid gap-3 md:hidden">
        {summaries.map((summary) => {
          const subscription = summary.organization.subscription;
          return (
            <article key={summary.id} className="min-w-0 rounded-md border border-stone-200 bg-white p-4">
              <p className="text-xs font-semibold text-stone-500">{formatAppDate(locale, summary.billingPeriod, { year: "numeric", month: "long", timeZone: "Asia/Taipei" })}</p>
              <Link href={subscription ? `/admin/subscriptions/${subscription.id}` : "/admin/subscriptions"} className="mt-1 inline-flex min-h-11 w-full min-w-0 items-center break-all text-lg font-semibold text-teal-800">
                {summary.organization.businessName}
              </Link>
              <p className="break-words text-sm text-stone-600">{subscription?.planVersion.displayName ?? m("No subscription")}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <MobileDetail label={m("Billable orders")} value={formatAppNumber(locale, summary.billableOrderCount)} />
                <MobileDetail label={m("Allowance")} value={subscription?.planVersion.includedOrders == null ? m("Per contract") : formatAppNumber(locale, subscription.planVersion.includedOrders)} />
                <MobileDetail label={m("Stalls")} value={formatAppNumber(locale, summary.activeStallCount)} />
                <MobileDetail label={m("Staff")} value={formatAppNumber(locale, summary.activeStaffCount)} />
                <MobileDetail label="QR" value={formatAppNumber(locale, summary.qrCodeCount)} />
                <div className="col-span-2 min-w-0">
                  <dt className="text-xs font-semibold text-stone-500">{m("Calculated at")}</dt>
                  <dd className="mt-1 break-words">{formatAppDateTime(locale, summary.calculatedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <div data-testid="admin-usage-desktop-table" className="mt-6 hidden overflow-x-auto border-y border-stone-200 md:block">
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
                    <Link href={subscription ? `/admin/subscriptions/${subscription.id}` : "/admin/subscriptions"} className="inline-flex min-h-11 items-center text-teal-800">
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
      </div>
      {summaries.length === 0 ? <p className="mt-6 border-y border-stone-200 px-3 py-8 text-sm text-stone-500">{m("There are no usage summaries.")}</p> : null}
    </main>
  );
}

function MobileDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>;
}
