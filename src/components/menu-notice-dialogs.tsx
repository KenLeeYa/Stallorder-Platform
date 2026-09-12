"use client";
import { useCallback, useEffect, useState } from "react";
import type { AppLocale } from "@/lib/app-locale";
import type { PublicMenu } from "@/lib/public-menu-types";
import { activeMenuAnnouncement, menuNoticeLabels, type MenuAnnouncementView } from "@/lib/menu-announcement";
import { SpecialClosureNoticeDialog } from "./special-closure-notice-dialog";
import { ExperienceDialog } from "./experience-dialog";

export function MenuNoticeDialogs({ closure, announcement, locale, timeZone }: {
  closure: PublicMenu["specialClosure"]; announcement?: MenuAnnouncementView | null;
  locale: AppLocale; timeZone: string;
}) {
  const [closureSettled, setClosureSettled] = useState(!closure);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const settled = useCallback(() => setClosureSettled(true), []);
  const labels = menuNoticeLabels[locale];
  const storageKey = announcement ? "stallorder:menu-announcement:" + announcement.stallId : "";
  useEffect(() => {
    if (!closureSettled || !announcement) return;
    const refresh = () => {
      const eligible = activeMenuAnnouncement(announcement);
      let dismissed = false;
      try { dismissed = sessionStorage.getItem(storageKey) === announcement.revision; } catch { /* Dismissal still works for this render. */ }
      setActive(eligible);
      setOpen(eligible && !dismissed);
    };
    const timer = setTimeout(refresh, 0);
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const scheduleExpiry = () => {
      if (!announcement.endsAt) return;
      const remaining = Date.parse(announcement.endsAt) - Date.now();
      if (remaining <= 0) { setActive(false); setOpen(false); return; }
      expiry = setTimeout(scheduleExpiry, Math.min(2_147_483_647, remaining));
    };
    scheduleExpiry();
    return () => { clearTimeout(timer); if (expiry !== null) clearTimeout(expiry); };
  }, [announcement, closureSettled, storageKey]);
  function dismiss() {
    if (announcement) {
      try { sessionStorage.setItem(storageKey, announcement.revision); } catch { /* Private browsing may deny storage. */ }
    }
    setOpen(false);
  }
  return <>
    {closure ? <SpecialClosureNoticeDialog closure={closure} locale={locale} timeZone={timeZone} onSettled={settled} /> : null}
    {announcement && active ? <div className="mx-auto max-w-6xl px-4 pt-4 print:hidden">
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-full border border-teal-700 bg-white px-5 py-2 text-sm font-semibold text-teal-800">{labels.view}</button>
      <ExperienceDialog open={open} onClose={dismiss} title={announcement.title} closeLabel={labels.close}>
        <p className="mb-3 text-sm font-semibold text-teal-700">{labels.title}</p>
        <p className="whitespace-pre-wrap leading-7 [overflow-wrap:anywhere]">{announcement.content}</p>
        <button type="button" onClick={dismiss} className="mt-6 min-h-12 w-full rounded-lg bg-teal-700 px-4 text-white">{labels.dismiss}</button>
      </ExperienceDialog>
    </div> : null}
  </>;
}
