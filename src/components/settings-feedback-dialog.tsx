"use client";

import { useEffect, useRef } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";

export type SettingsFeedbackKind = "success" | "error";

export function SettingsFeedbackDialog({
  message,
  kind,
  onClose,
  focusAfterClose,
}: {
  message: string;
  kind: SettingsFeedbackKind;
  onClose: () => void;
  focusAfterClose?: () => void;
}) {
  const { t } = useAppLocale();
  const dialogRef = useRef<HTMLElement>(null);
  const acknowledgeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    acknowledgeRef.current?.focus();

    const keepFocusInside = (event: FocusEvent) => {
      if (dialogRef.current?.contains(event.target as Node)) return;
      acknowledgeRef.current?.focus();
    };
    document.addEventListener("focusin", keepFocusInside);

    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = previousBodyOverflow;
      if (!closedRef.current) returnFocusRef.current?.focus();
    };
  }, []);

  function close() {
    closedRef.current = true;
    const returnFocus = returnFocusRef.current;
    onClose();
    requestAnimationFrame(() => {
      if (focusAfterClose) focusAfterClose();
      else returnFocus?.focus();
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const title = t(kind === "error" ? "feedback.error.title" : "feedback.success.title");

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" data-testid="settings-feedback-dialog-backdrop">
      <section
        ref={dialogRef}
        role={kind === "error" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="settings-feedback-title"
        aria-describedby="settings-feedback-message"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-2xl bg-white p-5 text-stone-950 shadow-2xl sm:p-6"
      >
        <div className="flex items-start gap-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${kind === "error" ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-800"}`}>
            {kind === "error" ? <TriangleAlert className="h-6 w-6" aria-hidden="true" /> : <CircleCheck className="h-6 w-6" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="settings-feedback-title" className="text-xl font-bold">{title}</h2>
            <p id="settings-feedback-message" role={kind === "success" ? "status" : undefined} className="mt-2 break-words text-sm leading-6 text-stone-700">{message}</p>
          </div>
          <button type="button" onClick={close} aria-label={t("feedback.close")} title={t("feedback.close")} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-stone-300"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <button ref={acknowledgeRef} type="button" onClick={close} className={`mt-6 min-h-12 w-full rounded-xl px-4 text-base font-semibold text-white ${kind === "error" ? "bg-red-700 hover:bg-red-800" : "bg-teal-800 hover:bg-teal-900"}`}>
          {t("feedback.acknowledge")}
        </button>
      </section>
    </div>
  );
}
