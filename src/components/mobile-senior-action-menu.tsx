"use client";

import { LayoutGrid, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  readAccessibilityMode,
  readServerAccessibilityMode,
  shouldUseMobileSeniorMenu,
  subscribeAccessibilityMode,
} from "@/lib/accessibility-mode";

const compactMediaQuery = "(max-width: 1023px)";

export function MobileSeniorActionMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const mode = useSyncExternalStore(
    subscribeAccessibilityMode,
    readAccessibilityMode,
    readServerAccessibilityMode,
  );
  const mobile = useSyncExternalStore(subscribeMobile, readMobile, readServerMobile);
  const active = shouldUseMobileSeniorMenu(mode, mobile);
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = () => setOpen(false);
    const unsubscribeMode = subscribeAccessibilityMode(close);
    const media = window.matchMedia(compactMediaQuery);
    media.addEventListener("change", close);
    return () => {
      unsubscribeMode();
      media.removeEventListener("change", close);
    };
  }, []);

  useEffect(() => {
    if (!open || !active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [active, open]);

  if (!active) return children;

  function handleAction(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a")) {
      setOpen(false);
      return;
    }
    if (target.closest("summary")) return;
    if (!target.closest("button, [role='button']")) return;
    window.setTimeout(() => {
      const anotherDialog = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"))
        .some((dialog) => dialog !== dialogRef.current);
      if (!anotherDialog) setOpen(false);
    }, 0);
  }

  return (
    <>
      <button
        type="button"
        data-testid="senior-action-menu-launcher"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-xl border border-teal-700 bg-teal-50 px-5 text-lg font-bold text-teal-900 lg:hidden"
      >
        <LayoutGrid className="h-7 w-7" aria-hidden="true" />
        {label}
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/65 p-3">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="m-auto flex h-[calc(100dvh-1.5rem)] max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white text-stone-950 shadow-2xl sm:max-w-[calc(100vw-1.5rem)]"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-stone-200 px-5 py-4">
              <div>
                <p className="text-sm font-bold text-teal-800">年長者模式</p>
                <h2 className="mt-1 text-2xl font-black">{label}</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="關閉功能選單"
                title="關閉功能選單"
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-stone-300 bg-white"
              >
                <X className="h-7 w-7" aria-hidden="true" />
              </button>
            </header>
            <div
              data-testid="senior-action-menu-content"
              onClickCapture={handleAction}
              className="senior-action-menu-content min-h-0 flex-1 overflow-y-auto p-4"
            >
              {children}
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function subscribeMobile(onStoreChange: () => void) {
  const media = window.matchMedia(compactMediaQuery);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function readMobile() {
  return window.matchMedia(compactMediaQuery).matches;
}

function readServerMobile() {
  return false;
}
