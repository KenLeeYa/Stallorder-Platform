"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { SETTINGS_DIRTY_EVENT } from "@/lib/unsaved-settings";

export function StallSettingsShell({
  children,
  showToolbar = true,
}: {
  children: React.ReactNode;
  showToolbar?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [dirtyScopes, setDirtyScopes] = useState<Set<string>>(new Set());
  const dirty = dirtyScopes.size > 0;

  useEffect(() => {
    const handleDirty = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; dirty?: boolean }>).detail;
      if (!detail?.scope) return;
      const scope = detail.scope;
      setDirtyScopes((current) => {
        const next = new Set(current);
        if (detail.dirty) next.add(scope);
        else next.delete(scope);
        return next;
      });
      const section = rootRef.current?.querySelector<HTMLElement>(`[data-settings-scope="${CSS.escape(scope)}"]`);
      if (section) section.dataset.dirty = detail.dirty ? "true" : "false";
    };
    window.addEventListener(SETTINGS_DIRTY_EVENT, handleDirty);
    return () => window.removeEventListener(SETTINGS_DIRTY_EVENT, handleDirty);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const handleLink = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank") return;
      const destination = new URL(target.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (!window.confirm("尚有未儲存的設定，確定要離開此頁？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLink, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLink, true);
    };
  }, [dirty]);

  useEffect(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-TW");
    rootRef.current?.querySelectorAll<HTMLElement>("[data-settings-section]").forEach((section) => {
      const text = (section.dataset.settingsSearch ?? section.textContent ?? "").toLocaleLowerCase("zh-TW");
      const visible = !normalized || text.includes(normalized);
      section.hidden = !visible;
      if (visible && normalized && section instanceof HTMLDetailsElement) section.open = true;
    });
  }, [query]);

  return (
    <div ref={rootRef}>
      {showToolbar ? <div className="mb-5 flex flex-col gap-3 border-y border-stone-200 py-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-stone-400" /><span className="sr-only">搜尋攤位設定</span><input type="search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋設定" className="h-11 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm" /></label>
        {dirty ? <span role="status" className="text-xs font-semibold text-amber-800">{dirtyScopes.size} 個區段尚未儲存</span> : null}
      </div> : null}
      {children}
    </div>
  );
}
