"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LayoutGrid, Search, type LucideIcon } from "lucide-react";
import { ExperienceDialog } from "@/components/experience-dialog";
import type { AppLocale } from "@/lib/app-locale";
import { workspaceNavigationMessage as message, type WorkspaceNavigationGroup } from "@/lib/messages/workspace-navigation";

export type WorkspaceFunction = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: WorkspaceNavigationGroup;
  primary?: boolean;
};

/** Receives only authorized destinations. This component never grants access. */
export function WorkspaceFunctionNavigation({ items, locale, label, testId, sidebar = false, responsive = false }: {
  items: readonly WorkspaceFunction[]; locale: AppLocale; label: string; testId: string; sidebar?: boolean; responsive?: boolean;
}) {
  const pathname = usePathname();
  const searchId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = items.filter(item => pathname === item.href.split("?")[0] || pathname.startsWith(`${item.href.split("?")[0]}/`))
    .sort((a, b) => b.href.split("?")[0].length - a.href.split("?")[0].length)[0];
  const normalized = query.trim().toLocaleLowerCase(locale);
  const filtered = items.filter(item => `${item.label} ${message(locale, item.group)}`.toLocaleLowerCase(locale).includes(normalized));
  const groups = [...new Set(items.map(item => item.group))];
  const primary = items.filter(item => item.primary).slice(0, 5);
  if (current && !primary.includes(current) && primary.length < 5) primary.push(current);
  // Merchant templates close the directory on navigation. Keep its Link mounted until then,
  // otherwise closing the dialog can interrupt a pending App Router transition.
  const link = (item: WorkspaceFunction, close: boolean, toolbar = false) => <Link key={item.href} href={item.href} prefetch={false}
    title={item.label} aria-label={item.label} onClick={close && (!responsive || pathname === item.href.split("?")[0]) ? () => setOpen(false) : undefined} aria-current={current === item ? "page" : undefined}
    data-primary={toolbar ? primary.includes(item) : undefined}
    className={`workspace-function-link${toolbar ? " workspace-toolbar-function" : ""}`}><item.icon aria-hidden="true" className="h-5 w-5 shrink-0" /><span>{item.label}</span></Link>;
  const directory = <>
    <label className="mb-2 block text-sm font-semibold" htmlFor={searchId}>{message(locale, "search")}</label>
    <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4" />
      <input id={searchId} type="search" autoComplete="off" maxLength={160} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === "Escape" && !sidebar) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }} className="min-h-11 w-full rounded-lg border border-stone-300 bg-white py-2 pl-10 pr-3" /></div>
    {filtered.length === 0 ? <p role="status" className="py-5 text-sm text-stone-600">{message(locale, "empty")}</p> : groups.map(group => {
      const rows = filtered.filter(item => item.group === group);
      return rows.length ? <section key={group} className="mt-5"><h3 className="mb-1 text-xs font-bold text-stone-600">{message(locale, group)}</h3>
        <div className="grid gap-1">{rows.map(item => link(item, !sidebar))}</div></section> : null;
    })}
  </>;
  if (sidebar) return <>
    {current ? <nav aria-label={message(locale, "location")} className="mb-4 border-b border-stone-200 pb-3 text-sm">
      <span className="text-xs text-stone-600">{message(locale, current.group)}</span><span aria-current="page" className="mt-1 block font-semibold">{current.label}</span>
    </nav> : null}
    <nav aria-label={label} data-testid={testId} className="workspace-sidebar">{directory}</nav>
  </>;
  return <>
    <nav aria-label={label} data-testid={testId} className={`flex min-w-0 items-center gap-2${responsive ? " workspace-responsive-navigation" : ""}`}>
      <div data-persist-horizontal-scroll={testId} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">{(responsive ? items : primary).map(item => link(item, false, responsive))}</div>
      <button type="button" title={message(locale, "all")} aria-label={message(locale, "all")} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(""); setOpen(true); }} className="workspace-function-link workspace-all-functions shrink-0 border border-stone-300">
        <LayoutGrid aria-hidden="true" className="h-5 w-5" /><span>{message(locale, "all")}</span>
      </button>
    </nav>
    {current ? <nav aria-label={message(locale, "location")} className="mt-1 flex min-w-0 items-center gap-1 text-xs text-stone-600">
      <span>{message(locale, current.group)}</span><ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" /><span aria-current="page" className="truncate">{current.label}</span>
    </nav> : null}
    <ExperienceDialog open={open} onClose={() => setOpen(false)} title={message(locale, "all")} closeLabel={message(locale, "close")}>{directory}</ExperienceDialog>
  </>;
}
