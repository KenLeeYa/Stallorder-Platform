"use client";

import { useEffect, useId, useRef } from "react";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";

export function PublicOrderFeedbackDialog({
  title,
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  busy = false,
  danger = false,
}: {
  title: string;
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-stone-950/65 p-4" role="presentation">
      <section
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onSecondary?.();
          }
          if (event.key !== "Tab") return;
          event.stopPropagation();
          const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
          const first = buttons[0];
          const last = buttons.at(-1);
          if (!first || !last) { event.preventDefault(); panelRef.current?.focus(); }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col rounded-2xl bg-white p-6 text-stone-950 shadow-2xl"
      >
        {onSecondary ? (
          <button
            type="button"
            aria-label={secondaryLabel ?? title}
            disabled={busy}
            onClick={onSecondary}
            className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-stone-500 hover:bg-stone-100 disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : null}
        <AlertTriangle aria-hidden="true" className={`h-10 w-10 shrink-0 ${danger ? "text-red-700" : "text-amber-600"}`} />
        <h2 id={titleId} className="mt-3 shrink-0 pr-10 text-xl font-bold">{title}</h2>
        <p id={descriptionId} className="mt-3 min-h-0 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm leading-6 text-stone-700">{message}</p>
        <div className="mt-6 grid shrink-0 gap-2 sm:grid-cols-2">
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              disabled={busy}
              onClick={onSecondary}
              className="min-h-12 rounded-md border border-stone-300 bg-white px-4 font-semibold disabled:opacity-50"
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onPrimary}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 font-semibold text-white disabled:opacity-50 ${danger ? "bg-red-700" : "bg-teal-700"} ${secondaryLabel && onSecondary ? "" : "sm:col-span-2"}`}
          >
            {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
            {primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
