"use client";

import { CalendarOff, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppLocale } from "@/lib/app-locale";
import { publicMessages } from "@/lib/messages/public";
import type { PublicMenu } from "@/lib/public-menu-types";
import {
  dateInTimeZone,
  localizeSpecialClosureTitle,
  specialClosureAppliesOnDate,
} from "@/lib/special-closures-client";

type SpecialClosureNotice = NonNullable<PublicMenu["specialClosure"]>;

export function SpecialClosureNoticeDialog({
  closure,
  locale,
  timeZone,
}: {
  closure: SpecialClosureNotice;
  locale: AppLocale;
  timeZone: string;
}) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrationSnapshot, serverHydrationSnapshot);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const storageKey = `stallorder:special-closure-notice:${closure.id}`;
  const signature = JSON.stringify([
    closure.startsOn,
    closure.endsOn,
    closure.opensAt ?? null,
    closure.closesAt ?? null,
    closure.title,
    closure.message,
  ]);
  const appliesToday = hydrated
    && specialClosureAppliesOnDate(closure, dateInTimeZone(new Date(), timeZone));
  const open = appliesToday
    && dismissedSignature !== signature
    && readDismissedSignature(storageKey) !== signature;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      rememberDismissal(storageKey, signature);
      setDismissedSignature(signature);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, signature, storageKey]);

  if (!open) return null;

  const dismiss = () => {
    rememberDismissal(storageKey, signature);
    setDismissedSignature(signature);
  };
  const title = localizeSpecialClosureTitle(closure.title, locale);

  return (
    <div data-testid="special-closure-notice-dialog" className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-stone-950/70 p-4 print:hidden">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="special-closure-notice-title"
        aria-describedby="special-closure-notice-description"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 text-stone-950 shadow-2xl dark:bg-stone-900 dark:text-stone-50"
      >
        <button type="button" aria-label={publicMessages.get(locale, "specialClosureNoticeClose")} onClick={dismiss} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-stone-500 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <CalendarOff className="h-7 w-7" aria-hidden="true" />
        </span>
        <p className="mt-4 text-sm font-semibold text-teal-700 dark:text-teal-300">
          {publicMessages.get(locale, "specialClosureNoticeEyebrow")}
        </p>
        <h2 id="special-closure-notice-title" className="mt-1 pr-10 text-2xl font-bold">{title}</h2>
        <div id="special-closure-notice-description" className="mt-4 rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-800">
          <p className="font-semibold">{formatClosureRange(closure, locale)}</p>
          {closure.message ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-200">{closure.message}</p> : null}
        </div>
        <button type="button" autoFocus onClick={dismiss} className="mt-6 min-h-12 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800">
          {publicMessages.get(locale, "specialClosureNoticeDismiss")}
        </button>
      </section>
    </div>
  );
}

function subscribeToHydration() {
  return () => undefined;
}

function clientHydrationSnapshot() {
  return true;
}

function serverHydrationSnapshot() {
  return false;
}

function readDismissedSignature(storageKey: string) {
  try {
    return window.sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function rememberDismissal(storageKey: string, signature: string) {
  try {
    window.sessionStorage.setItem(storageKey, signature);
  } catch {
    // The dialog can still be dismissed when browser storage is unavailable.
  }
}

function formatClosureRange(closure: SpecialClosureNotice, locale: AppLocale) {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const start = formatter.format(new Date(`${closure.startsOn}T00:00:00.000Z`));
  const dates = closure.startsOn === closure.endsOn
    ? start
    : `${start} – ${formatter.format(new Date(`${closure.endsOn}T00:00:00.000Z`))}`;
  return closure.opensAt && closure.closesAt
    ? `${dates} · ${closure.opensAt}–${closure.closesAt}`
    : dates;
}
