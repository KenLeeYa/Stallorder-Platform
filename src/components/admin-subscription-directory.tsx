"use client";

import { useState } from "react";
import Link from "next/link";
import { useAdminLocale } from "@/lib/messages/admin-client";
import { managementExperienceMessage as message } from "@/lib/messages/management-experience";
import { getAdminCodeLabel } from "@/lib/messages/admin";
import { formatAppDate, formatAppNumber } from "@/lib/locale-format";

export type SubscriptionDirectoryRow = {
  id: string; organizationId: string; businessName: string; status: string;
  plan: string; periodStart: string; periodEnd: string; orderCount: number;
};
export function AdminSubscriptionDirectory({ rows }: { rows: SubscriptionDirectoryRow[] }) {
  const { m, locale } = useAdminLocale();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [requestedPage, setPage] = useState(1);
  const normalized = query.trim().toLocaleLowerCase(locale);
  const matches = rows.filter(row => (!status || row.status === status) && `${row.businessName} ${row.organizationId} ${row.id}`.toLocaleLowerCase(locale).includes(normalized));
  const pages = Math.max(1, Math.ceil(matches.length / 5));
  const page = Math.min(requestedPage, pages);
  const visible = matches.slice((page - 1) * 5, page * 5);
  return <section className="mt-6" aria-label={m("Subscription management")}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 basis-52 text-sm font-semibold">{message(locale, "search")}<input type="search" autoComplete="off" maxLength={160} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3" /></label>
      <label className="text-sm font-semibold">{m("Status")}<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="mt-1 block min-h-11 rounded-lg border border-stone-300 bg-white px-3"><option value="">{message(locale, "all")}</option>{[...new Set(rows.map(row => row.status))].map(value => <option key={value} value={value}>{getAdminCodeLabel(locale, value)}</option>)}</select></label>
    </div>
    <div data-testid="admin-subscriptions-mobile-list" className="mt-4 grid min-w-0 gap-3 md:hidden">{visible.map(row => <article key={row.id} className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="font-semibold">{row.businessName}</h2><p className="mt-1 text-sm text-stone-600">{getAdminCodeLabel(locale, row.status)} · {row.plan}</p>
      <p className="mt-2 text-sm">{formatAppDate(locale, row.periodStart)} – {formatAppDate(locale, row.periodEnd)}</p>
      <Link className="mt-3 inline-flex min-h-11 items-center font-semibold text-teal-800" href={`/admin/subscriptions/${row.id}`}>{m("Manage")}</Link>
    </article>)}</div>
    <div data-testid="admin-subscriptions-desktop-table" className="mt-4 hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><caption className="sr-only">{m("Subscription management")}</caption>
      <thead className="border-b border-stone-300 text-stone-600"><tr>{["Merchant", "Status", "Plan version", "Billing period", "Reconciled orders", "Manage"].map(label => <th key={label} scope="col" className="px-3 py-3">{m(label as "Merchant" | "Status" | "Plan version" | "Billing period" | "Reconciled orders" | "Manage")}</th>)}</tr></thead>
      <tbody>{visible.map(row => <tr key={row.id} className="border-b border-stone-200"><th scope="row" className="px-3 py-4 font-semibold">{row.businessName}</th><td className="px-3 py-4">{getAdminCodeLabel(locale, row.status)}</td><td className="px-3 py-4">{row.plan}</td><td className="px-3 py-4">{formatAppDate(locale, row.periodStart)} – {formatAppDate(locale, row.periodEnd)}</td><td className="px-3 py-4 tabular-nums">{formatAppNumber(locale, row.orderCount)}</td><td className="px-3 py-4"><Link href={`/admin/subscriptions/${row.id}`} className="inline-flex min-h-11 items-center font-semibold text-teal-800">{m("Manage")}</Link></td></tr>)}</tbody>
    </table></div>
    {!visible.length ? <p role="status" className="py-8 text-sm text-stone-600">{m("There are no subscriptions.")}</p> : null}
    <div className="mt-4 flex items-center justify-between gap-3"><span role="status" className="text-sm tabular-nums">{page} / {pages} · {formatAppNumber(locale, matches.length)}</span>
      <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-11 rounded-lg border border-stone-300 px-3 disabled:opacity-40">{message(locale, "previous")}</button><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-11 rounded-lg border border-stone-300 px-3 disabled:opacity-40">{message(locale, "next")}</button></div>
    </div>
  </section>;
}
