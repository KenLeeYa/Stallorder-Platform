"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { historyReadResultSchema, historyDetailResultSchema, type HistoryRow, type historyReadInputSchema } from "@/lib/operations-read-contract";
import type { z } from "zod";
import type { AppLocale } from "@/lib/app-locale";
import type { HistoryLabels, ReadLabels } from "@/lib/operations-labels";
import { interpolateMessage, type MessageValues } from "@/lib/message-catalog";
import { formatAppCurrency, formatAppDateTime } from "@/lib/locale-format";
import { readQueryOptions, retryOperationsReadNow } from "@/lib/operations-query";
import { OperationsReadFeedback } from "@/components/operations-read-feedback";
import { useOperationsAuthority } from "@/components/operations-query-provider";

type Input = z.infer<typeof historyReadInputSchema>;
export function OrderHistoryTable({ initialInput, locale, currency, labels, readLabels }: { initialInput: Input; locale: AppLocale; currency: string; labels: HistoryLabels; readLabels: ReadLabels }) {
  const authority = useOperationsAuthority();
  const [input, setInput] = useState(initialInput);
  const [detailId, setDetailId] = useState<string | null>(null);
  const t = useCallback((key: keyof HistoryLabels, values: MessageValues = {}) => interpolateMessage(labels[key], values), [labels]);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const triggerId = useRef<string | null>(null);
  const returnFocus = useRef(false);
  const [focusNotice, setFocusNotice] = useState("");
  function openDetail(id: string) { triggerId.current = id; setFocusNotice(""); setDetailId(detailId === id ? null : id); }
  function closeDetail() {
    returnFocus.current = true;
    setDetailId(null);
  }
  const params = new URLSearchParams(Object.entries(input).filter(([key]) => key !== "stallIds").map(([key,value]) => [key,String(value)]));
  for (const id of input.stallIds) params.append("stallId", id);
  const query = useQuery(readQueryOptions(authority.scope, "order-history", input, `/api/merchant/reports/orders?${params}`, historyReadResultSchema, authority));
  function update(values: Partial<Input>) { const next = { ...input, ...values }; setDetailId(null); setInput(next); const url = new URL(window.location.href); url.searchParams.set("page", String(next.page)); url.searchParams.set("pageSize", String(next.pageSize)); url.searchParams.set("sort", next.sort); window.history.replaceState(null, "", url); }
  const columns: ColumnDef<HistoryRow>[] = [
    { accessorKey: "orderNo", header: t("reports.orders.list.order"), cell: ({ row }) => <strong className="break-words">#{row.original.orderNo} · {row.original.stall.name}</strong> },
    { accessorKey: "createdAt", header: t("reports.orders.list.time"), cell: ({ row }) => formatAppDateTime(locale, row.original.createdAt) },
    { accessorKey: "status", header: t("reports.orders.list.status"), cell: ({ row }) => statusLabel(labels,row.original.status) },
    { accessorKey: "fulfillmentType", header: t("reports.orders.list.fulfillment"), cell: ({ row }) => fulfillmentLabel(labels,row.original.fulfillmentType) },
    { accessorKey: "total", header: t("reports.orders.list.total"), cell: ({ row }) => formatAppCurrency(locale, row.original.total, currency, { maximumFractionDigits: 0 }) },
    { id: "detail", header: t("reports.orders.list.actions"), cell: ({ row }) => <button type="button" className="min-h-12 min-w-12 rounded-md border px-4" data-history-order-id={row.id} aria-expanded={detailId === row.id} onClick={() => openDetail(row.id)}>{t("reports.orders.list.details")}</button> },
  ];
  const pagination = query.data?.pagination;
  const table = useReactTable({ data: query.data?.rows ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId: row => row.id, manualPagination: true, manualSorting: true, manualFiltering: true, rowCount: pagination?.total ?? 0, state: { pagination: { pageIndex: (pagination?.page ?? input.page) - 1, pageSize: input.pageSize } }, onPaginationChange: next => { const old = { pageIndex: input.page - 1, pageSize: input.pageSize }; const value = typeof next === "function" ? next(old) : next; update({ page: value.pageIndex + 1, pageSize: value.pageSize as Input["pageSize"] }); } });
  useLayoutEffect(() => {
    if (detailId || !returnFocus.current) return;
    returnFocus.current = false;
    const buttons = heading.current?.closest("section")?.querySelectorAll<HTMLButtonElement>("button[data-history-order-id]");
    const current = Array.from(buttons ?? []).find(button => button.dataset.historyOrderId === triggerId.current && button.getClientRects().length);
    if (current) current.focus();
    else { heading.current?.focus(); setFocusNotice(t("reports.orders.list.rowGone")); }
  }, [detailId, t]);
  return <section id="orders-list" className="py-7" aria-busy={query.isPending}>
    <h2 ref={heading} tabIndex={-1} className="sr-only">{t("reports.orders.list.list")}</h2><p role="status" className="sr-only">{focusNotice}</p>
    <p className="mb-4 text-sm">{t("reports.orders.list.lag")}</p>
    <div className="mb-4 flex flex-wrap gap-3"><button type="button" className="min-h-12 min-w-12 border px-4" onClick={() => retryOperationsReadNow(query.failureReason ?? query.error, () => query.refetch())}>{readLabels["重新整理"]}</button><label>{t("reports.orders.list.sort")}<select className="ml-2 min-h-12 border px-3" value={input.sort} onChange={e => update({ sort: e.target.value as Input["sort"], page: 1 })}><option value="createdAtDesc">{t("reports.orders.list.newest")}</option><option value="createdAtAsc">{t("reports.orders.list.oldest")}</option></select></label></div>
    <OperationsReadFeedback labels={readLabels} locale={locale} error={query.failureReason ?? query.error} updatedAt={query.dataUpdatedAt} onRetry={() => retryOperationsReadNow(query.failureReason ?? query.error, () => query.refetch())} />
    {query.isPending ? <p>{t("reports.orders.list.loading")}</p> : query.error ? null : <>
      <p role="status">{t("reports.orders.list.count", { count: pagination?.total ?? 0 })}{query.isFetching ? t("reports.orders.list.updating") : ""}</p>
      <div className="mt-3 grid gap-3 lg:hidden">{table.getRowModel().rows.map(row => <article key={row.id} className="min-w-0 rounded-lg border p-4"><h2 className="break-words font-semibold">#{row.original.orderNo} · {row.original.stall.name}</h2><p>{formatAppDateTime(locale, row.original.createdAt)} · {statusLabel(labels,row.original.status)} · {fulfillmentLabel(labels,row.original.fulfillmentType)}</p><p>{formatAppCurrency(locale,row.original.total,currency)}</p><button type="button" className="mt-3 min-h-12 min-w-12 border px-4" data-history-order-id={row.id} aria-expanded={detailId === row.id} onClick={() => openDetail(row.id)}>{t("reports.orders.list.details")}</button></article>)}</div>
      <div className="mt-3 hidden overflow-x-auto lg:block"><table className="w-full text-left"><caption className="sr-only">{t("reports.orders.list.list")}</caption><thead>{table.getHeaderGroups().map(g => <tr key={g.id}>{g.headers.map(h => <th key={h.id} scope="col" className="p-3">{flexRender(h.column.columnDef.header,h.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(row => <tr key={row.id} className="border-t">{row.getVisibleCells().map(cell => <td key={cell.id} className="p-3">{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody></table></div>
      {!query.data?.rows.length ? <p className="py-8">{t("reports.orders.none")}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" className="min-h-12 min-w-12 border px-4" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>{readLabels["上一頁"]}</button><span>{pagination?.page ?? 1} / {pagination?.totalPages ?? 1}</span><button type="button" className="min-h-12 min-w-12 border px-4" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>{readLabels["下一頁"]}</button><label>{readLabels["每頁"]}<select className="ml-2 min-h-12 border px-3" value={input.pageSize} onChange={e => update({ pageSize: Number(e.target.value) as Input["pageSize"], page: 1 })}>{[5,10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
    </>}
    {detailId ? <OrderDetail key={`${detailId}:${JSON.stringify(input)}`} id={detailId} params={params.toString()} locale={locale} currency={currency} labels={labels} readLabels={readLabels} onClose={closeDetail} /> : null}
  </section>;
}
function OrderDetail({ id, params, locale, currency, labels, readLabels, onClose }: { id: string; params: string; locale: AppLocale; currency: string; labels: HistoryLabels; readLabels: ReadLabels; onClose: () => void }) {
  const authority = useOperationsAuthority();
  const query = useQuery(readQueryOptions(authority.scope, "order-history-detail", { id, params }, `/api/merchant/reports/orders/${id}?${params}`, historyDetailResultSchema, authority));
  const order = query.data?.detail;
  const t = useCallback((key: keyof HistoryLabels, values: MessageValues = {}) => interpolateMessage(labels[key], values), [labels]);
  const close = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { close.current?.focus(); }, []);
  return <section aria-label={t("reports.orders.list.detail")} className="mt-5 rounded-lg bg-stone-50 p-4"><button type="button" ref={close} className="min-h-12 min-w-12 border px-4" onClick={onClose}>{t("reports.orders.list.close")}</button>{query.isPending ? <p aria-busy="true">{t("reports.orders.list.loadingDetail")}</p> : query.error ? <OperationsReadFeedback labels={readLabels} locale={locale} error={query.error} updatedAt={query.dataUpdatedAt} onRetry={() => retryOperationsReadNow(query.error, () => query.refetch())} /> : order ? <><h2 className="mt-3 font-semibold">#{order.orderNo}</h2><p>{statusLabel(labels,order.status)} · {fulfillmentLabel(labels,order.fulfillmentType)}</p><p>{order.customerName} {order.customerPhone} {order.tableLabel}</p><ul>{order.items.map(item => <li key={item.id}>{item.quantity} × {item.name} · {formatAppCurrency(locale,item.unitPrice*item.quantity,currency)} {item.note}</li>)}</ul><p>{order.payment?.methodLabel ?? (t("reports.orders.unpaid"))}</p><p>{order.note}</p><strong>{formatAppCurrency(locale,order.total,currency)}</strong></> : null}</section>;
}

function statusLabel(labels: HistoryLabels, status: HistoryRow["status"]) {
  const keys = { WAITING_CONFIRMATION: "waiting", CONFIRMED: "confirmed", PREPARING: "preparing", PACKING: "packing", READY: "ready", COMPLETED: "completed", CANCELLED: "cancelled", EXPIRED: "expired" } as const;
  return labels[`reports.orders.status.${keys[status]}`];
}
function fulfillmentLabel(labels: HistoryLabels, fulfillment: HistoryRow["fulfillmentType"]) {
  const keys = { TAKEOUT: "takeout", DINE_IN: "dineIn", DELIVERY: "delivery" } as const;
  return labels[`reports.orders.fulfillment.${keys[fulfillment]}`];
}
