"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

export type CompactSwitcherDestination = {
  value: string;
  label: string;
};

export function CompactSwitcherDialog({
  destinations,
  currentValue,
  buttonLabel,
  dialogTitle,
  icon,
  onSelect,
  className = "",
}: {
  destinations: readonly CompactSwitcherDestination[];
  currentValue: string;
  buttonLabel: string;
  dialogTitle: string;
  icon: ReactNode;
  onSelect: (value: string) => void | Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [open]);

  if (destinations.length === 0) return null;

  async function selectDestination(value: string) {
    setPendingValue(value);
    try {
      await onSelect(value);
      setOpen(false);
    } finally {
      setPendingValue(null);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        data-senior-action-tile="true"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={() => setOpen(true)}
        className={`inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 bg-white text-stone-700 transition-colors hover:border-teal-600 hover:bg-teal-50 hover:text-teal-800 ${className}`}
      >
        {icon}
      </button>

      {open && typeof document !== "undefined" ? createPortal(
        <div
          data-testid="compact-switcher-backdrop"
          className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-3 sm:p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            data-testid="compact-switcher-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialogTitle}
            className="m-auto flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[min(80dvh,42rem)]"
          >
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-stone-200 px-4 py-2">
              <h2 className="min-w-0 truncate text-base font-bold text-stone-950">{dialogTitle}</h2>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="關閉"
                title="關閉"
                onClick={() => setOpen(false)}
                className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 w-full overflow-y-auto p-3 sm:p-4">
              <div className="grid w-full min-w-0 grid-cols-1 gap-2">
                {destinations.map((destination) => {
                  const selected = destination.value === currentValue;
                  return (
                    <button
                      key={destination.value}
                      data-testid="compact-switcher-option"
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      disabled={pendingValue !== null}
                      onClick={() => void selectDestination(destination.value)}
                      className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold leading-5 disabled:opacity-60 ${selected ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-800 hover:border-teal-500 hover:bg-teal-50/60"}`}
                    >
                      <span className="min-w-0 flex-1 whitespace-normal break-words">{destination.label}</span>
                      {selected ? <Check className="h-5 w-5 shrink-0 text-teal-700" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
