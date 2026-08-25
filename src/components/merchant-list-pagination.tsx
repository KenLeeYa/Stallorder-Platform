"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatAppNumber } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import {
  OPERATIONS_PAGE_SIZES,
  type OperationsPageMeta,
  type OperationsPageSize,
} from "@/lib/operations-pagination";

export function MerchantListPageSizeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: OperationsPageSize;
  onChange: (value: OperationsPageSize) => void;
}) {
  const { locale, m } = useMerchantMessages();
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-600">
      {m("每頁")}
      <select
        aria-label={m("{label}每頁顯示數量", { label })}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as OperationsPageSize)}
        className="h-9 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900"
      >
        {OPERATIONS_PAGE_SIZES.map((pageSize) => (
          <option key={pageSize} value={pageSize}>{formatAppNumber(locale, pageSize)}</option>
        ))}
      </select>
      {m("筆")}
    </label>
  );
}

export function MerchantListPageNavigation({
  label,
  pagination,
  onPageChange,
}: {
  label: string;
  pagination: OperationsPageMeta;
  onPageChange: (page: number) => void;
}) {
  const { locale, m } = useMerchantMessages();
  return (
    <nav aria-label={m("{label}分頁", { label })} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
      <span>
        {pagination.total === 0
          ? m("沒有資料")
          : m("顯示 {first}–{last}，共 {total} 筆", {
              first: formatAppNumber(locale, pagination.firstItem),
              last: formatAppNumber(locale, pagination.lastItem),
              total: formatAppNumber(locale, pagination.total),
            })}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          title={m("{label}上一頁", { label })}
          aria-label={m("{label}上一頁", { label })}
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
          className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-20 text-center text-xs font-semibold text-stone-700">
          {m("第 {page} / {total} 頁", {
            page: formatAppNumber(locale, pagination.page),
            total: formatAppNumber(locale, pagination.totalPages),
          })}
        </span>
        <button
          type="button"
          title={m("{label}下一頁", { label })}
          aria-label={m("{label}下一頁", { label })}
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
          className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
