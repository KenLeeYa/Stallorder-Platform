"use client";

import { useEffect, useState } from "react";
import { specialClosureBlocksAt, type SpecialClosureView } from "@/lib/special-closures-client";
import type { PublicMenu } from "@/lib/public-menu-types";

type Snapshot = { identifier: string; timezone: string; closures: SpecialClosureView[] };

export function usePublicClosureNotice(
  identifier: string | undefined,
  initialClosure: PublicMenu["specialClosure"],
) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!identifier) return;
    let stopped = false;
    let activeRequest: AbortController | null = null;
    let refreshPending = false;
    const refresh = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (activeRequest) { refreshPending = true; return; }
      refreshPending = false;
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`/api/public/stores/${encodeURIComponent(identifier)}/closures`,
          { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        if (!payload || typeof payload.timezone !== "string" || !Array.isArray(payload.closures)
          || !payload.closures.every(isClosure)) return;
        // Validate the server's timezone before replacing a known blocking notice.
        new Intl.DateTimeFormat("en-US", { timeZone: payload.timezone }).format();
        if (!stopped && !controller.signal.aborted) setSnapshot({ identifier, timezone: payload.timezone, closures: payload.closures });
      } catch {
        // A failed refresh must retain the last known closure, including its block.
      } finally {
        window.clearTimeout(timeout);
        activeRequest = null;
        if (refreshPending && !stopped) void refresh();
      }
    };
    const onReturn = () => void refresh();
    void refresh();
    const timer = window.setInterval(onReturn, 30_000);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      stopped = true;
      activeRequest?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [identifier]);
  const current = snapshot?.identifier === identifier ? snapshot : null;
  const selected = current && (current.closures.find(closure => specialClosureBlocksAt(closure, current.timezone))
    ?? current.closures[0]);
  return {
    refreshed: Boolean(current),
    closure: current ? selected ? { ...selected, isActive: specialClosureBlocksAt(selected, current.timezone) } : null
      : initialClosure ?? null,
  };
}

function isClosure(value: unknown): value is SpecialClosureView {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["id", "title", "message"].every(key => typeof row[key] === "string")
    && ["startsOn", "endsOn"].every(key => {
      const date = row[key];
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const parsed = new Date(`${date}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    })
    && String(row.startsOn) <= String(row.endsOn)
    && ["opensAt", "closesAt"].every(key => row[key] == null || (typeof row[key] === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row[key] as string)))
    && Boolean(row.opensAt) === Boolean(row.closesAt)
    && (!row.opensAt || String(row.opensAt) < String(row.closesAt));
}
