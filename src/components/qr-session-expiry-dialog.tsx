"use client";

import { useEffect, useRef } from "react";

export function SessionExpiryDialog({
  expired,
  title,
  description,
  buttonLabel,
  onRefresh,
}: {
  expired: boolean;
  title: string;
  description: string;
  buttonLabel: string;
  onRefresh: () => void;
}) {
  const refreshButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => refreshButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      refreshButtonRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expiry-title"
        aria-describedby="session-expiry-description"
        data-testid="qr-session-expiry-dialog"
        data-expired={expired}
        className="w-full max-w-sm rounded-xl bg-white p-5 text-stone-900 shadow-2xl"
      >
        <h2 id="session-expiry-title" className="text-xl font-semibold">{title}</h2>
        <p id="session-expiry-description" className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
        <button
          ref={refreshButtonRef}
          type="button"
          onClick={onRefresh}
          className="mt-5 min-h-12 w-full rounded-md bg-teal-800 px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          {buttonLabel}
        </button>
      </section>
    </div>
  );
}
