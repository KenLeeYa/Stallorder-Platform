"use client";

import Link from "next/link";
import { getStaffDiscountState } from "@/lib/staff-discount-presentation";

type DiscountOption = { id: string; name: string; rateBps: number };

type Props = {
  enabled: boolean;
  options: DiscountOption[];
  selectedOptionId: string | null;
  onSelect: (optionId: string | null) => void;
  settingsHref?: string;
  existingDiscountLabel?: string | null;
  isApplicable?: boolean;
};

export function StaffDiscountSelector({ enabled, options, selectedOptionId, onSelect, settingsHref, existingDiscountLabel, isApplicable = true }: Props) {
  const state = getStaffDiscountState(enabled, options.length);
  const preservedDiscountLabel = selectedOptionId === null ? existingDiscountLabel : null;

  return (
    <section className="mt-4" aria-label="結帳折扣" data-testid={`staff-discount-${state.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-stone-600">折扣</p>
        {state === "AVAILABLE" && settingsHref ? <Link href={settingsHref} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-teal-800 underline underline-offset-2">管理折扣</Link> : null}
      </div>
      {state === "AVAILABLE" && !isApplicable ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950" role="status" data-testid="staff-discount-not-applicable">
          此訂單沒有可套用折扣的商品。
        </div>
      ) : state === "AVAILABLE" ? (
        <>
          <p className="mt-1 text-xs text-emerald-800" role="status">
            {preservedDiscountLabel
              ? `未另選店員折扣時，會保留「${preservedDiscountLabel}」。`
              : "可選擇已啟用的結帳折扣。"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" aria-pressed={selectedOptionId === null} onClick={() => onSelect(null)} className={`h-9 rounded-md border px-3 text-xs font-semibold ${selectedOptionId === null ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>{preservedDiscountLabel ? `保留 ${preservedDiscountLabel}` : "不折扣"}</button>
            {options.map((option) => (
              <button key={option.id} type="button" aria-pressed={selectedOptionId === option.id} onClick={() => onSelect(option.id)} className={`h-9 rounded-md border px-3 text-xs font-semibold ${selectedOptionId === option.id ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>{option.name}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950" role="status">
          <p className="font-semibold">{state === "DISABLED" ? "折扣模組尚未啟用" : "尚未設定可用折扣"}</p>
          <p className="mt-1">{preservedDiscountLabel
            ? `這筆訂單會保留「${preservedDiscountLabel}」。`
            : state === "DISABLED"
              ? "這筆訂單會以原價結帳。"
              : "折扣模組已開啟，但目前沒有已啟用的折扣選項。"}</p>
          {settingsHref
            ? <Link href={settingsHref} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-8 items-center font-semibold text-teal-800 underline underline-offset-2">開啟折扣設定</Link>
            : <p className="mt-1">請通知攤位管理員更新折扣設定。</p>}
        </div>
      )}
    </section>
  );
}
