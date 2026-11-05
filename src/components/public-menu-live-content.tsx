"use client";
import { CalendarOff } from "lucide-react";
import type { ReactNode } from "react";
import type { AppLocale } from "@/lib/app-locale";
import type { PublicMenu } from "@/lib/public-menu-types";
import { localizeSpecialClosureTitle } from "@/lib/special-closures-client";
import { MenuNoticeDialogs } from "./menu-notice-dialogs";
import { usePublicClosureNotice } from "./use-public-closure-notice";

export function PublicMenuLiveContent({ identifier, menu, locale, header, children }: {
  identifier: string; menu: Pick<PublicMenu, "specialClosure" | "announcement" | "stall">;
  locale: AppLocale; header: ReactNode; children: ReactNode;
}) {
  const { closure } = usePublicClosureNotice(identifier, menu.specialClosure);
  return <main data-testid="storefront-menu-view" className="min-h-screen bg-[#f5f1e8] text-stone-950 print:bg-white">
    <MenuNoticeDialogs key={JSON.stringify(closure)} closure={closure} announcement={menu.announcement} locale={locale} timeZone={menu.stall.timezone} />
    {header}
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9 lg:px-8">
        {closure ? (
          <section
            role={closure.isActive ? "alert" : "status"}
            data-testid="public-menu-special-closure"
            className={`mb-7 flex items-start gap-3 rounded-2xl border p-4 shadow-sm ${closure.isActive ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}
          >
            <CalendarOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-bold">{localizeSpecialClosureTitle(closure.title, locale)}</h2>
              <p className="mt-1 text-sm font-semibold">{formatClosureRange(closure, locale)}</p>
              {closure.message ? <p className="mt-1 text-sm leading-6">{closure.message}</p> : null}
            </div>
          </section>
        ) : null}
      {children}
    </div>
  </main>;
}

function formatClosureRange(
  closure: NonNullable<PublicMenu["specialClosure"]>,
  locale: AppLocale,
) {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const start = formatter.format(new Date(`${closure.startsOn}T00:00:00.000Z`));
  const dates = closure.startsOn === closure.endsOn
    ? start
    : `${start} – ${formatter.format(new Date(`${closure.endsOn}T00:00:00.000Z`))}`;
  return closure.opensAt && closure.closesAt
    ? `${dates} · ${closure.opensAt}–${closure.closesAt}`
    : dates;
}

