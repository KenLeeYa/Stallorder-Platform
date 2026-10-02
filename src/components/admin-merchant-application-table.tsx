"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { applicationReadResultSchema, applicationStatusSchema, type ApplicationReadInput, type ApplicationRow } from "@/lib/operations-read-contract";
import { readQueryOptions, retryOperationsReadNow } from "@/lib/operations-query";
import { OperationsReadFeedback } from "@/components/operations-read-feedback";
import { useOperationsAuthority } from "@/components/operations-query-provider";
import { useAdminLocale } from "@/lib/messages/admin-client";
import { getAdminCodeLabel } from "@/lib/messages/admin";
import { formatAppDate } from "@/lib/locale-format";

export function AdminMerchantApplicationTable({ initialInput, readLabels }: { initialInput: ApplicationReadInput; readLabels: import("@/lib/operations-labels").ReadLabels }) {
  const authority = useOperationsAuthority(); const { locale, m } = useAdminLocale();
  const [input, setInput] = useState(initialInput);
  const params = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key,value]) => [key,String(value)]));
  const query = useQuery(readQueryOptions(authority.scope, "merchant-applications", input, `/api/admin/merchant-applications?${params}`, applicationReadResultSchema, authority));
  function update(values: Partial<ApplicationReadInput>) { const next = { ...input, ...values }; setInput(next); const url = new URL(window.location.href); url.search = new URLSearchParams(Object.entries(next).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)])).toString(); window.history.replaceState(null,"",url); }
  const link = (row: ApplicationRow) => <Link className="inline-flex min-h-12 min-w-12 items-center rounded-md border px-4" href={`/admin/merchant-applications/${row.id}`}>{m(row.status === "PENDING_REVIEW" ? "Review" : "View record")}</Link>;
  const columns: ColumnDef<ApplicationRow>[] = [
    { accessorKey: "applicationNumber", header: m("Application number") }, { accessorKey: "merchantName", header: m("Merchant"), cell: ({ row }) => <strong className="break-words">{row.original.merchantName || m("Not entered")}</strong> },
    { accessorKey: "businessType", header: m("Type"), cell: ({row}) => getAdminCodeLabel(locale,row.original.businessType) },
    { accessorKey: "status", header: m("Status"), cell: ({row}) => getAdminCodeLabel(locale,row.original.status) }, { accessorKey: "riskLevel", header: m("Risk"), cell: ({row}) => getAdminCodeLabel(locale,row.original.riskLevel) },
    { accessorKey: "submittedAt", header: m("Submitted date"), cell: ({row}) => row.original.submittedAt ? formatAppDate(locale,row.original.submittedAt) : "-" },
    { id: "reviewer", header: m("Reviewer"), cell: ({row}) => row.original.assignedReviewer?.displayName ?? m("Unassigned") }, { id: "actions", header: m("Actions"), cell: ({row}) => link(row.original) },
  ];
  const pagination = query.data?.pagination;
  const table = useReactTable({ data: query.data?.rows ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId: row => row.id, manualPagination: true, manualSorting: true, manualFiltering: true, rowCount: pagination?.total ?? 0, state: { pagination: { pageIndex: (pagination?.page ?? input.page)-1, pageSize: input.pageSize } }, onPaginationChange: value => { const old = { pageIndex: input.page-1, pageSize: input.pageSize }; const next = typeof value === "function" ? value(old) : value; update({ page: next.pageIndex+1, pageSize: next.pageSize as ApplicationReadInput["pageSize"] }); } });
  const filters = [
    { key: "status", label: m("Status"), values: applicationStatusSchema.options }, { key: "riskLevel", label: m("Risk"), values: ["LOW","MEDIUM","HIGH","BLOCKED"] },
    { key: "duplicateReason", label: m("Duplicate signal"), values: ["DUPLICATE_EMAIL","DUPLICATE_PHONE","DUPLICATE_SLUG"] }, { key: "reviewer", label: m("Reviewer"), values: ["ASSIGNED","UNASSIGNED"] },
    { key: "submitted", label: m("Submitted time"), values: ["TODAY","OLDER_THAN_2_DAYS"] }, { key: "sort", label: locale === "zh-TW" ? "排序" : "Sort", values: ["review","submittedAtAsc","submittedAtDesc"] },
  ] as const;
  return <section className="mt-6" aria-busy={query.isPending}>
    <div className="flex flex-wrap gap-3 border-y py-4">{filters.map(filter => <label key={filter.key} className="text-sm">{filter.label}<select aria-label={filter.label} className="mt-1 block min-h-12 rounded-md border px-3" value={input[filter.key] ?? ""} onChange={e => update({ [filter.key]: e.target.value || undefined, page: 1 })}>{filter.key !== "sort" ? <option value="">{m("All")}</option> : null}{filter.values.map(value => <option key={value} value={value}>{getAdminCodeLabel(locale,value)}</option>)}</select></label>)}<button type="button" className="self-end min-h-12 min-w-12 border px-4" onClick={() => update({ page: 1, pageSize: input.pageSize, sort: "review", status: undefined, riskLevel: undefined, duplicateReason: undefined, reviewer: undefined, reviewerId: undefined, submitted: undefined })}>{m("Clear")}</button><button type="button" className="self-end min-h-12 min-w-12 border px-4" onClick={() => retryOperationsReadNow(query.failureReason ?? query.error, () => query.refetch())}>{locale === "zh-TW" ? "重新整理" : "Refresh"}</button></div>
    <OperationsReadFeedback labels={readLabels} locale={locale} error={query.failureReason ?? query.error} updatedAt={query.dataUpdatedAt} onRetry={() => retryOperationsReadNow(query.failureReason ?? query.error, () => query.refetch())} />
    {query.isPending ? <p>{locale === "zh-TW" ? "載入申請…" : "Loading applications…"}</p> : query.error ? <p role="alert">{query.error.message}</p> : <>
      <p role="status" className="my-4">{pagination?.total ?? 0} {locale === "zh-TW" ? "筆申請" : "applications"}{query.isFetching ? (locale === "zh-TW" ? " · 更新中…" : " · Updating…") : ""}</p>
      <div data-testid="merchant-applications-mobile-list" className="grid gap-3 lg:hidden">{table.getRowModel().rows.map(row => <article data-testid="merchant-application-record" data-row-id={row.id} key={row.id} className="min-w-0 rounded-lg border p-4"><p className="break-all text-sm">{row.original.applicationNumber}</p><h2 className="break-words text-lg font-semibold">{row.original.merchantName || m("Not entered")}</h2><p>{getAdminCodeLabel(locale,row.original.status)} · {getAdminCodeLabel(locale,row.original.riskLevel)}</p><p>{row.original.assignedReviewer?.displayName ?? m("Unassigned")}</p><div className="mt-3">{link(row.original)}</div></article>)}</div>
      <div data-testid="merchant-applications-desktop-table" className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm"><caption className="sr-only">{m("Merchant application review")}</caption><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" className="p-3">{flexRender(header.column.columnDef.header,header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(row => <tr key={row.id} data-row-id={row.id} className="border-t">{row.getVisibleCells().map(cell => <td key={cell.id} className="p-3">{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody></table></div>
      {!query.data?.rows.length ? <p className="py-8">{m("There are no matching applications.")}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" className="min-h-12 min-w-12 border px-4" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>{locale === "zh-TW" ? "上一頁" : "Previous"}</button><span>{pagination?.page ?? 1} / {pagination?.totalPages ?? 1}</span><button type="button" className="min-h-12 min-w-12 border px-4" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>{locale === "zh-TW" ? "下一頁" : "Next"}</button><label>{locale === "zh-TW" ? "每頁" : "Page size"}<select className="ml-2 min-h-12 border px-3" value={input.pageSize} onChange={e => update({ pageSize: Number(e.target.value) as ApplicationReadInput["pageSize"], page: 1 })}>{[5,10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
    </>}
  </section>;
}
