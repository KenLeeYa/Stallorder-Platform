"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ExperienceDialog({ open, onClose, title, closeLabel = "關閉", children }: {
  open: boolean; onClose: () => void; title: string; closeLabel?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const active = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (active instanceof HTMLElement && active.isConnected) active.focus();
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={ref} aria-label={title} onCancel={onClose}
      onClose={event => { if (!event.currentTarget.open) onClose(); }}
      onKeyDown={event => {
        if (event.key !== "Tab" || (event.target instanceof Element && event.target.closest("dialog") !== event.currentTarget)) return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        )).filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
        const first = controls[0], last = controls.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 text-stone-950 shadow-xl backdrop:bg-black/65">
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="min-w-0 whitespace-normal text-xl font-bold [overflow-wrap:anywhere]">{title}</h2>
        <button type="button" autoFocus aria-label={closeLabel} onClick={onClose}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-stone-300"><X className="h-5 w-5" /></button>
      </div>
      {children}
    </dialog>, document.body);
}
