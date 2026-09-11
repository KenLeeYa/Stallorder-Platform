"use client";

import { useState } from "react";
import { useOperationsLocale } from "./operations-locale";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import { formatMoney } from "@/lib/money";

type Product = StaffOrderCatalog["products"][number];
export type ConfiguredEditProduct = {
  productId: string; note: string; noteOptionIds: string[]; bundleChoiceIds: string[];
  unitPrice: number; details: string;
};

export function StaffOrderEditProductPicker({ product, currency, busy, onAdd }: {
  product: Product; currency: string; busy: boolean; onAdd: (item: ConfiguredEditProduct) => void;
}) {
  const { locale, t } = useOperationsLocale();
  const [noteOptionIds, setNoteOptionIds] = useState<string[]>([]);
  const [bundleChoiceIds, setBundleChoiceIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const bundles = product.bundleChoiceGroups ?? [];
  const validBundle = product.kind !== "BUNDLE" || (bundles.length > 0 && bundles.every((group) => {
    const count = group.choices.filter((choice) => bundleChoiceIds.includes(choice.id)).length;
    return count >= group.minSelections && count <= group.maxSelections;
  }));
  const valid = validBundle && noteSelectionIsValid(product.noteGroups, noteOptionIds);
  const selectedNotes = product.noteGroups.flatMap((group) => group.options.filter((option) => noteOptionIds.includes(option.id)).map((option) => `${group.name}：${option.name}`));
  const selectedBundle = bundles.flatMap((group) => group.choices.filter((choice) => bundleChoiceIds.includes(choice.id)).map((choice) => `${group.name}：${choice.name}`));
  const price = product.price + notePriceAdjustment(product.noteGroups, noteOptionIds)
    + bundles.flatMap((group) => group.choices).filter((choice) => bundleChoiceIds.includes(choice.id)).reduce((sum, choice) => sum + choice.priceDelta, 0);
  return <div className="mt-3 grid gap-3">
    {bundles.map((group) => <fieldset key={group.id} className="rounded-lg border border-stone-300 p-3"><legend className="px-1 text-sm font-semibold">{group.name}（{group.minSelections}–{group.maxSelections}）</legend><div className="grid gap-2 sm:grid-cols-2">
      {group.choices.map((choice) => <label key={choice.id} className="flex min-h-11 items-center gap-2 rounded-md border border-stone-300 p-2 text-sm"><input className="ordering-checkbox" type={group.maxSelections === 1 ? "radio" : "checkbox"} name={`edit-bundle-${group.id}`} checked={bundleChoiceIds.includes(choice.id)} disabled={busy} onChange={() => setBundleChoiceIds((current) => {
        if (group.maxSelections === 1) return [...current.filter((id) => !group.choices.some((row) => row.id === id)), choice.id];
        if (current.includes(choice.id)) return current.filter((id) => id !== choice.id);
        return group.choices.filter((row) => current.includes(row.id)).length < group.maxSelections ? [...current, choice.id] : current;
      })} /><span>{choice.name}{choice.priceDelta ? ` ${formatMoney(choice.priceDelta, currency, locale)}` : ""}</span></label>)}
    </div>{group.minSelections === 0 && group.maxSelections === 1 ? <button type="button" disabled={busy} className="mt-2 min-h-11 px-2 text-sm underline" onClick={() => setBundleChoiceIds((current) => current.filter((id) => !group.choices.some((choice) => choice.id === id)))}>{t("staff.edit.clearSelection")}</button> : null}</fieldset>)}
    {product.noteGroups.map((group) => <fieldset key={group.id} className="rounded-lg border border-stone-300 p-3"><legend className="px-1 text-sm font-semibold">{group.name}（{group.minSelections}–{group.maxSelections ?? group.options.length}）</legend><div className="grid gap-2 sm:grid-cols-2">
      {group.options.map((option) => <label key={option.id} className="flex min-h-11 items-center gap-2 rounded-md border border-stone-300 p-2 text-sm"><input className="ordering-checkbox" type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`edit-note-${group.id}`} checked={noteOptionIds.includes(option.id)} disabled={busy} onChange={() => setNoteOptionIds((current) => toggleNoteOption(current, group, option.id))} /><span>{option.name}{option.priceDelta ? ` ${formatMoney(option.priceDelta, currency, locale)}` : ""}</span></label>)}
    </div>{group.minSelections === 0 && group.selectionMode === "SINGLE" ? <button type="button" disabled={busy} className="mt-2 min-h-11 px-2 text-sm underline" onClick={() => setNoteOptionIds((current) => current.filter((id) => !group.options.some((option) => option.id === id)))}>{t("staff.edit.clearSelection")}</button> : null}</fieldset>)}
    <label className="text-sm font-medium">{t("staff.edit.itemNote")}<input maxLength={1000} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-stone-300 px-3" /></label>
    {!valid ? <p role="status" className="text-sm text-amber-800">{t("staff.edit.chooseRequired")}</p> : null}
    <button type="button" disabled={busy || !valid} onClick={() => onAdd({ productId: product.id, note, noteOptionIds, bundleChoiceIds, unitPrice: price, details: [...selectedBundle, ...selectedNotes, note].filter(Boolean).join(" · ") })} className="min-h-11 rounded-md bg-teal-700 px-4 font-semibold text-white disabled:opacity-40">{t("staff.edit.add")} · {formatMoney(price, currency, locale)}</button>
  </div>;
}
