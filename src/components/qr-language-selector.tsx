"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { LocaleFlag } from "@/components/locale-flag";
import { qrOrderMessages, type QrLocale } from "@/lib/qr-order-i18n";

export function QrLanguageSelector({
  locale,
  locales,
  label,
  menuLabel,
  onChange,
}: {
  locale: QrLocale;
  locales: QrLocale[];
  label: string;
  menuLabel: string;
  onChange: (locale: QrLocale) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-40 text-xs font-medium text-stone-500">
      <span>{label}</span>
      <button
        type="button"
        aria-label={menuLabel}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        data-current-locale={locale}
        onClick={() => setOpen((current) => !current)}
        className="mt-1 flex h-10 w-full items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-left text-sm font-medium text-stone-900"
      >
        <LocaleFlag locale={locale} />
        <span className="min-w-0 flex-1 truncate" lang={locale}>{qrOrderMessages[locale].localeName}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div id={menuId} role="listbox" aria-label={menuLabel} className="absolute right-0 z-30 mt-1 min-w-full overflow-hidden rounded-md border border-stone-200 bg-white py-1 shadow-lg">
          {locales.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="option"
              aria-selected={candidate === locale}
              onClick={() => {
                onChange(candidate);
                setOpen(false);
              }}
              className={`flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm text-stone-900 hover:bg-stone-100 ${candidate === locale ? "bg-teal-50" : ""}`}
            >
              <LocaleFlag locale={candidate} />
              <span className="min-w-0 flex-1 whitespace-nowrap" lang={candidate}>{qrOrderMessages[candidate].localeName}</span>
              {candidate === locale ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-teal-700" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
