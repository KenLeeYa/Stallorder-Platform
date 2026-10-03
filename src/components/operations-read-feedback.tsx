"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppLocale } from "@/lib/app-locale";
import type { ReadLabels } from "@/lib/operations-labels";
import { interpolateMessage } from "@/lib/message-catalog";
import { OperationsReadError } from "@/lib/operations-query";

const subscribe = (notify: () => void) => { window.addEventListener("online", notify); window.addEventListener("offline", notify); return () => { window.removeEventListener("online", notify); window.removeEventListener("offline", notify); }; };
export function useOperationsOnline() { return useSyncExternalStore(subscribe, () => navigator.onLine, () => true); }
export function OperationsReadFeedback({ error, updatedAt, onRetry, labels, locale = "zh-TW" }: { labels: ReadLabels; locale?: AppLocale; error: unknown; updatedAt: number; onRetry: () => void }) {
  const m = (key: keyof ReadLabels, values: Record<string, string | number> = {}) => interpolateMessage(labels[key], values);
  const online = useOperationsOnline();
  const [now, setNow] = useState(() => Date.now());
  const deadline = error instanceof OperationsReadError ? error.retryAt : null;
  useEffect(() => { if (deadline === null) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [deadline]);
  const remaining = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
  if (!online) return <p role="status" className="my-3 rounded-md border p-3">{m("目前離線；顯示的資料可能已過期。")}{updatedAt ? m("最後讀取：{time}",{time:new Date(updatedAt).toLocaleTimeString(locale)}) : m("尚未讀取資料。")}</p>;
  if (!(error instanceof OperationsReadError)) return null;
  const message = m( error.kind === "schema" ? "資料格式不符，請重新整理。" : error.status === 0 ? "無法連線，請稍後重試。" : error.status === 429 ? "讀取暫時受限。" : "讀取失敗，請重新整理。");
  return <div role="alert" className="my-3 rounded-md border p-3"><p>{message}{remaining > 0 ? " "+m("請等待 {seconds} 秒。",{seconds:remaining}) : ""}</p><button type="button" className="mt-2 min-h-12 min-w-12 rounded-md border px-4" disabled={remaining > 0} onClick={onRetry}>{m("重試")}</button></div>;
}
