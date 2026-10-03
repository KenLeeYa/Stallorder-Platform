"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { STAFF_QUEUE_FILTERS, STAFF_QUEUE_SOURCES, type StaffQueueFilter, type StaffQueueSource } from "./staff-order-queue";

type Preferences = { filter: StaffQueueFilter; source: StaffQueueSource; recentOnly: boolean };
const defaults: Preferences = { filter: "ALL", source: "ALL", recentOnly: false };
const eventName = "stallorder-queue-preferences";
export function parseQueuePreferences(raw: string): Preferences {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return defaults;
    const row = value as Record<string, unknown>;
    return {
      filter: STAFF_QUEUE_FILTERS.includes(row.filter as StaffQueueFilter) ? row.filter as StaffQueueFilter : "ALL",
      source: STAFF_QUEUE_SOURCES.includes(row.source as StaffQueueSource) ? row.source as StaffQueueSource : "ALL",
      recentOnly: row.recentOnly === true,
    };
  } catch { return defaults; }
}
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  return () => window.removeEventListener(eventName, callback);
}
const serverSnapshot = () => "";
// Session-scoped, allowlisted presentation preferences only; no query, customer or order data.
export function useStaffQueuePreferences(stallId: string, role: string) {
  const key = `stallorder:queue:v1:${stallId}:${role}`;
  const fallback = useRef(new Map<string, string>());
  const read = useCallback(() => { try { return fallback.current.get(key) ?? sessionStorage.getItem(key) ?? ""; } catch { return fallback.current.get(key) ?? ""; } }, [key]);
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  const preferences = parseQueuePreferences(raw);
  const update = (patch: Partial<Preferences>) => {
    const value = JSON.stringify({ ...preferences, ...patch });
    fallback.current.set(key, value);
    try { sessionStorage.setItem(key, value); } catch { /* In-memory filtering remains available when storage is blocked. */ }
    window.dispatchEvent(new Event(eventName));
  };
  return [preferences, update] as const;
}
