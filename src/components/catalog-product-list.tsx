"use client";

import type { CatalogLabels, ReadLabels } from "@/lib/operations-labels";
import { interpolateMessage } from "@/lib/message-catalog";
import { isAppLocale } from "@/lib/app-locale";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { catalogEditorResultSchema, catalogReadResultSchema, type CatalogReadInput, type ProductListRow } from "@/lib/operations-read-contract";
import { operationsKey, readQueryOptions, retryOperationsReadNow } from "@/lib/operations-query";
import { OperationsReadFeedback, useOperationsOnline } from "@/components/operations-read-feedback";
import { useOperationsAuthority } from "@/components/operations-query-provider";
import { LazySharedCatalogManager } from "@/components/lazy-shared-catalog-manager";
import { RefreshCw, Settings2 } from "lucide-react";

export function CatalogProductList({ initialInput, organizationName, labels, readLabels }: { initialInput: CatalogReadInput; organizationName: string; labels: CatalogLabels; readLabels: ReadLabels }) {
  const online = useOperationsOnline();
  const authority = useOperationsAuthority();
  const client = useQueryClient();
  const [input, setInput] = useState(initialInput);
  const locale = isAppLocale(input.locale) ? input.locale : "zh-TW";
  const m = (key: keyof CatalogLabels, values: Record<string, string | number> = {}) => interpolateMessage(labels[key], values);
  const [search, setSearch] = useState(input.q);
  const [editorTarget, setEditorTarget] = useState<string | null | undefined>(undefined);
  const update = useCallback((values: Partial<CatalogReadInput>) => {
    const next = { ...input, ...values }; setInput(next);
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) { const urlKey = key === "stallId" ? "filterStallId" : key; if (value === undefined || value === "") params.delete(urlKey); else params.set(urlKey, String(value)); }
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [input]);
  useEffect(() => { const timer = setTimeout(() => { if (search !== input.q) update({ q: search, page: 1 }); }, 300); return () => clearTimeout(timer); }, [search, input.q, update]);
  const org = authority.scope.context.kind === "organization" ? authority.scope.context.organizationId : "";
  const parameters = new URLSearchParams(Object.entries(input).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)]));
  const query = useQuery({ ...readQueryOptions(authority.scope, "catalog-products", input, `/api/merchant/organizations/${org}/catalog/products?${parameters}`, catalogReadResultSchema, authority), enabled: editorTarget === undefined });
  const editor = useQuery({ ...readQueryOptions(authority.scope, "catalog-editor", {}, `/api/merchant/organizations/${org}/catalog/editor`, catalogEditorResultSchema, authority), enabled: editorTarget !== undefined, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const columns: ColumnDef<ProductListRow>[] = [
    { accessorKey: "localizedName", header: m("商品"), cell: ({ row }) => <strong className="break-words">{row.original.localizedName}</strong> },
    { accessorKey: "defaultPrice", header: m("價格") },
    { accessorKey: "isActive", header: m("狀態"), cell: ({ row }) => row.original.isActive ? m("啟用") : m("停用") },
    { id: "edit", header: m("操作"), cell: ({ row }) => <button type="button" className="min-h-12 min-w-12 rounded-md border px-4" disabled={!online} onClick={() => setEditorTarget(row.id)}>{m("編輯")}</button> },
  ];
  const pagination = query.data?.pagination;
  const table = useReactTable({ data: query.data?.rows ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id, manualPagination: true, manualFiltering: true, manualSorting: true, rowCount: pagination?.total ?? 0, state: { pagination: { pageIndex: (pagination?.page ?? input.page) - 1, pageSize: input.pageSize } }, onPaginationChange: (value) => { const old = { pageIndex: input.page - 1, pageSize: input.pageSize }; const next = typeof value === "function" ? value(old) : value; update({ page: next.pageIndex + 1, pageSize: next.pageSize as CatalogReadInput["pageSize"] }); } });
  const closeEditor = () => { setEditorTarget(undefined); client.removeQueries({ queryKey: operationsKey(authority.scope, "catalog-editor", {}), exact: true }); void client.invalidateQueries({ queryKey: operationsKey(authority.scope, "catalog-products", input), exact: true }); };
  if (editorTarget === null) return <section>
    <button type="button" className="mb-4 min-h-12 min-w-12 rounded-md border px-4" onClick={closeEditor}>{m("返回商品清單")}</button>
    {editor.isPending ? <p aria-busy="true">{m("載入完整商品管理…")}</p> : editor.error ? <OperationsReadFeedback labels={readLabels} locale={locale} error={editor.failureReason ?? editor.error} updatedAt={editor.dataUpdatedAt} onRetry={() => retryOperationsReadNow(editor.failureReason ?? editor.error, () => editor.refetch())} /> : editor.data ? <LazySharedCatalogManager {...editor.data.editor} initialProductId={editorTarget ?? undefined} onCatalogChanged={() => { void client.invalidateQueries({ queryKey: operationsKey(authority.scope, "catalog-products", input), exact: true }); }} /> : null}
  </section>;
  return <section aria-labelledby="catalog-heading">
    <div className="flex min-w-0 items-start gap-3">
      <div className="min-w-0 flex-1"><h1 id="catalog-heading" className="whitespace-nowrap text-2xl font-semibold sm:text-3xl">{m("共用商品")}</h1><p className="mt-2 break-words text-sm">{organizationName}</p></div>
      <div className="ml-auto flex shrink-0 justify-end gap-2">
        <button type="button" aria-label={m("完整管理／新增商品")} title={m("完整管理／新增商品")} className="inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-md border px-3" disabled={!online} onClick={() => setEditorTarget(null)}><Settings2 className="h-5 w-5" /><span className="hidden xl:inline">{m("完整管理／新增商品")}</span></button>
        <button type="button" aria-label={m("重新整理")} title={m("重新整理")} className="inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-md border px-3" onClick={() => retryOperationsReadNow(query.failureReason ?? query.error, () => query.refetch())}><RefreshCw className="h-5 w-5" /><span className="hidden xl:inline">{m("重新整理")}</span></button>
      </div>
    </div>
    <div className="my-5 grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(8rem,auto)_minmax(10rem,auto)]">
      <label className="col-span-2 min-w-0 md:col-span-1">{m("搜尋商品")}<input aria-label={m("搜尋商品")} type="search" maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 min-h-12 w-full rounded-md border px-3" /></label>
      <label className="min-w-0">{m("狀態")}<select className="mt-1 block min-h-12 w-full rounded-md border px-3" value={input.active} onChange={(e) => update({ active: e.target.value as CatalogReadInput["active"], page: 1 })}><option value="all">{m("全部")}</option><option value="active">{m("啟用")}</option><option value="inactive">{m("停用")}</option></select></label>
      <label className="min-w-0">{m("排序")}<select className="mt-1 block min-h-12 w-full rounded-md border px-3" value={input.sort} onChange={(e) => update({ sort: e.target.value as CatalogReadInput["sort"], page: 1 })}><option value="catalog">{m("目錄順序")}</option><option value="nameAsc">{m("名稱遞增")}</option><option value="nameDesc">{m("名稱遞減")}</option></select></label>
    </div>
    <OperationsReadFeedback labels={readLabels} locale={locale} error={query.failureReason ?? query.error} updatedAt={query.dataUpdatedAt} onRetry={() => retryOperationsReadNow(query.failureReason ?? query.error, () => query.refetch())} />
    {query.isPending ? <p aria-busy="true">{m("載入商品…")}</p> : query.error ? null : <>
      <p role="status" className="mb-3 text-sm">{m("共 {count} 項商品", { count: pagination?.total ?? 0 })}{query.isFetching ? m(" · 更新中…") : ""}</p>
      <div className="grid gap-3 lg:hidden">{table.getRowModel().rows.map((row) => <article key={row.id} className="min-w-0 rounded-lg border p-4"><h2 className="break-words font-semibold">{row.original.localizedName}</h2><p>{row.original.defaultPrice} · {row.original.isActive ? m("啟用") : m("停用")}</p><button className="mt-3 min-h-12 min-w-12 rounded-md border px-4" aria-label={`${m("編輯")} ${row.original.localizedName}`} disabled={!online} onClick={() => setEditorTarget(row.id)}>{m("編輯")}</button></article>)}</div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full text-left"><caption className="sr-only">{m("授權組織商品清單")}</caption><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} scope="col" className="p-3">{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className="border-t">{row.getVisibleCells().map((cell) => <td key={cell.id} className="p-3">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
      {!table.getRowModel().rows.length ? <p className="py-8">{m("沒有符合條件的商品。")}<button className="min-h-12 border px-4" onClick={() => { setSearch(""); update({ q: "", active: "all", categoryId: undefined, groupId: undefined, stallId: undefined, page: 1 }); }}>{m("清除篩選")}</button></p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button className="min-h-12 min-w-12 border px-4" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>{m("上一頁")}</button><span>{pagination?.page ?? 1} / {pagination?.totalPages ?? 1}</span><button className="min-h-12 min-w-12 border px-4" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>{m("下一頁")}</button><label>{m("每頁")}<select aria-label={m("每頁商品數")} className="ml-2 min-h-12 border px-3" value={input.pageSize} onChange={(e) => update({ pageSize: Number(e.target.value) as CatalogReadInput["pageSize"], page: 1 })}>{[5,10,25,50,100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
    </>}
    {typeof editorTarget === "string" ? <div>
      {editor.isPending || editor.error ? <button type="button" className="mt-4 min-h-12 rounded-md border px-4" onClick={closeEditor}>{m("返回商品清單")}</button> : null}
      {editor.isPending ? <p aria-busy="true">{m("載入完整商品管理…")}</p> : editor.error ? <OperationsReadFeedback labels={readLabels} locale={locale} error={editor.failureReason ?? editor.error} updatedAt={editor.dataUpdatedAt} onRetry={() => retryOperationsReadNow(editor.failureReason ?? editor.error, () => editor.refetch())} /> : editor.data ? <LazySharedCatalogManager key={editorTarget} {...editor.data.editor} initialProductId={editorTarget} onProductEditorClose={closeEditor} onCatalogChanged={() => { void client.invalidateQueries({ queryKey: operationsKey(authority.scope, "catalog-products", input), exact: true }); }} /> : null}
    </div> : null}
  </section>;
}
