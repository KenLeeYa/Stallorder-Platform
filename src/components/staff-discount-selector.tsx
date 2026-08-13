"use client";

import Link from "next/link";
import { useOperationsLocale } from "@/components/operations-locale";
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
  const { t } = useOperationsLocale();
  const state = getStaffDiscountState(enabled, options.length);
  const preservedDiscountLabel = selectedOptionId === null ? existingDiscountLabel : null;

  return (
    <section className="mt-4" aria-label={t("discount.aria")} data-testid={`staff-discount-${state.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-stone-600">{t("discount.label")}</p>
        {state === "AVAILABLE" && settingsHref ? <Link href={settingsHref} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-teal-800 underline underline-offset-2">{t("discount.manage")}</Link> : null}
      </div>
      {state === "AVAILABLE" && !isApplicable ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950" role="status" data-testid="staff-discount-not-applicable">
          {t("discount.notApplicable")}
        </div>
      ) : state === "AVAILABLE" ? (
        <>
          <p className="mt-1 text-xs text-emerald-800" role="status">
            {preservedDiscountLabel
              ? t("discount.preserveHint", { label: preservedDiscountLabel })
              : t("discount.availableHint")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" aria-pressed={selectedOptionId === null} onClick={() => onSelect(null)} className={`h-9 rounded-md border px-3 text-xs font-semibold ${selectedOptionId === null ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>{preservedDiscountLabel ? t("discount.preserve", { label: preservedDiscountLabel }) : t("discount.none")}</button>
            {options.map((option) => (
              <button key={option.id} type="button" aria-pressed={selectedOptionId === option.id} onClick={() => onSelect(option.id)} className={`h-9 rounded-md border px-3 text-xs font-semibold ${selectedOptionId === option.id ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>{option.name}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950" role="status">
          <p className="font-semibold">{state === "DISABLED" ? t("discount.moduleDisabled") : t("discount.noneConfigured")}</p>
          <p className="mt-1">{preservedDiscountLabel
            ? t("discount.orderKeeps", { label: preservedDiscountLabel })
            : state === "DISABLED"
              ? t("discount.originalPrice")
              : t("discount.noEnabledOptions")}</p>
          {settingsHref
            ? <Link href={settingsHref} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-8 items-center font-semibold text-teal-800 underline underline-offset-2">{t("discount.openSettings")}</Link>
            : <p className="mt-1">{t("discount.notifyManager")}</p>}
        </div>
      )}
    </section>
  );
}
