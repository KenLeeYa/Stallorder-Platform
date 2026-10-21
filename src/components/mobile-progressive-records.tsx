"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

const mobileQuery = "(max-width: 767px)";
function subscribe(callback: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const mobileSnapshot = () => window.matchMedia(mobileQuery).matches;
const serverSnapshot = () => false;

export function MobileProgressiveRecords<T>({ items, scopeKey, label, children }: {
  items: readonly T[];
  scopeKey: string;
  label: string;
  children: (records: readonly T[]) => ReactNode;
}) {
  const mobile = useSyncExternalStore(subscribe, mobileSnapshot, serverSnapshot);
  const [view, setView] = useState({ items, scopeKey, count: 6 });
  if (view.items !== items || view.scopeKey !== scopeKey) {
    setView({ items, scopeKey, count: 6 });
  }
  const count = view.items === items && view.scopeKey === scopeKey ? view.count : 6;
  return <>
    {mobile ? <div aria-label={`${label}清單顯示`} className="my-3 flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="text-sm text-stone-600">已載入 {items.length} 件 · 顯示 {Math.min(count, items.length)} 件</p>
      {items.length > 6 ? <div className="flex gap-2">
        <button type="button" aria-label={`顯示更多${label}`} disabled={count >= items.length} onClick={() => setView({ items, scopeKey, count: count + 6 })} className="min-h-11 rounded-md border border-stone-300 px-3 text-sm disabled:opacity-40">顯示更多</button>
        <button type="button" aria-label={`收合${label}`} disabled={count <= 6} onClick={() => setView({ items, scopeKey, count: 6 })} className="min-h-11 rounded-md border border-stone-300 px-3 text-sm disabled:opacity-40">收合</button>
      </div> : null}
    </div> : null}
    {children(mobile ? items.slice(0, count) : items)}
  </>;
}
