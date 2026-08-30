"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Percent, X } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { getStaffDiscountState } from "@/lib/staff-discount-presentation";

type DiscountOption = { id: string; name: string; rateBps: number };

type Props = {
  enabled: boolean;
  options: DiscountOption[];
  selectedOptionId: string | null;
  onSelect: (optionId: string | null) => void;
  existingDiscountLabel?: string | null;
  isApplicable?: boolean;
};

export function StaffDiscountSelector({ enabled, options, selectedOptionId, onSelect, existingDiscountLabel, isApplicable = true }: Props) {
  const { t } = useOperationsLocale();
  const [open, setOpen] = useState(false);
  const state = getStaffDiscountState(enabled, options.length);
  const preservedDiscountLabel = selectedOptionId === null ? existingDiscountLabel : null;
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? null;
  const canSelect = state === "AVAILABLE" && isApplicable;
  const triggerLabel = selectedOption?.name ?? preservedDiscountLabel ?? t("discount.label");
  const unavailableMessage = !isApplicable
    ? t("discount.notApplicable")
    : state === "DISABLED"
      ? t("discount.moduleDisabled")
      : t("discount.noneConfigured");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <section className="min-w-0" aria-label={t("discount.aria")} data-testid={`staff-discount-${state.toLowerCase()}`}>
      <button
        type="button"
        data-testid="staff-discount-trigger"
        title={canSelect ? t("discount.aria") : unavailableMessage}
        aria-label={`${t("discount.aria")}：${triggerLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex h-11 min-w-24 max-w-full items-center justify-center gap-2 rounded-md border border-teal-700 bg-white px-3 text-sm font-semibold text-teal-900"
      >
        <Percent className="h-4 w-4 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <section data-testid="staff-discount-dialog" role="dialog" aria-modal="true" aria-label={t("discount.aria")} className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">{t("discount.aria")}</h3>
              <button type="button" autoFocus title={t("common.close")} aria-label={t("common.close")} onClick={() => setOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><X className="h-5 w-5" /></button>
            </div>
            {canSelect ? <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" aria-pressed={selectedOptionId === null} onClick={() => { onSelect(null); setOpen(false); }} className={`min-h-16 rounded-lg border px-3 text-sm font-semibold ${selectedOptionId === null ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300"}`}>{preservedDiscountLabel ? t("discount.preserve", { label: preservedDiscountLabel }) : t("discount.none")}</button>
              {options.map((option) => (
                <button key={option.id} type="button" aria-pressed={selectedOptionId === option.id} onClick={() => { onSelect(option.id); setOpen(false); }} className={`min-h-16 rounded-lg border px-3 text-sm font-semibold ${selectedOptionId === option.id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300"}`}>{option.name}</button>
              ))}
            </div> : <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-950" role="status">{unavailableMessage}</p>}
          </section>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
