"use client";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { readApiJson } from "@/lib/api-response";
import { type MenuAnnouncementView } from "@/lib/menu-announcement";
import { ExperienceDialog } from "./experience-dialog";

// The inputs display the stall time zone, independent of the operator's device.
function localInput(iso: string | null, timeZone: string) {
  if (!iso) return "";
  const parts = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return parts.get("year") + "-" + parts.get("month") + "-" + parts.get("day") + "T" + parts.get("hour") + ":" + parts.get("minute");
}
export function announcementInputToIso(value: string, timeZone: string) {
  if (!value) return null;
  const target = Date.parse(value + ":00Z");
  let guess = target;
  for (let count = 0; count < 4; count++) {
    const represented = Date.parse(localInput(new Date(guess).toISOString(), timeZone) + ":00Z");
    if (represented === target) return new Date(guess).toISOString();
    guess += target - represented;
  }
  throw new Error("這個時間在攤位時區不存在，請重新選擇。");
}
export function StallMenuAnnouncementManager({ stallId, timeZone, initial }: {
  stallId: string; timeZone: string; initial: MenuAnnouncementView | null;
}) {
  const [draft, setDraft] = useState({
    enabled: initial?.enabled ?? false, title: initial?.title ?? "", content: initial?.content ?? "",
    startsAt: localInput(initial?.startsAt ?? null, timeZone), endsAt: localInput(initial?.endsAt ?? null, timeZone),
  });
  const [revision, setRevision] = useState(initial?.revision ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/merchant/stalls/" + stallId + "/menu-announcement", {
        method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({
          ...draft, startsAt: announcementInputToIso(draft.startsAt, timeZone), endsAt: announcementInputToIso(draft.endsAt, timeZone),
          expectedRevision: revision,
        }),
      });
      const body = await readApiJson<{ error?: string; announcement: MenuAnnouncementView }>(response, "公告暫時無法儲存，請稍後重試。");
      if (!response.ok) throw new Error(body.error ?? "無法儲存公告。");
      setRevision(body.announcement.revision);
      setMessage(draft.enabled ? "公告已儲存，將依指定時間顯示於線上 Menu。" : "公告已關閉，顧客不會再看到提醒視窗。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "無法儲存公告，請稍後重試。"); }
    finally { setBusy(false); }
  }
  const field = "mt-2 min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2";
  return <form onSubmit={save} className="max-w-3xl space-y-5" data-testid="menu-announcement-manager">
    <p className="text-sm leading-6 text-stone-600">顧客進入線上 Menu 時顯示一則公告；關閉後可再次點「查看店家公告」。特殊店休提醒會優先顯示。</p>
    <button type="button" aria-pressed={draft.enabled} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
      className={field + (draft.enabled ? " border-teal-700 text-teal-800" : "")}>{draft.enabled ? "公告開啟" : "公告關閉"}</button>
    <label className="block font-semibold">公告標題<input className={field} value={draft.title} maxLength={80} required={draft.enabled}
      onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="例如：本週來店優惠" /></label>
    <label className="block font-semibold">公告內容<textarea className={field + " min-h-40 whitespace-pre-wrap"} value={draft.content} maxLength={2000} required={draft.enabled}
      onChange={event => setDraft({ ...draft, content: event.target.value })} placeholder="填寫活動、優惠或營運提醒。支援換行，顧客可關閉後繼續查看菜單。" /></label>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="block min-w-0 font-semibold">開始顯示<input type="datetime-local" className={field} value={draft.startsAt} onChange={event => setDraft({ ...draft, startsAt: event.target.value })} /></label>
      <label className="block min-w-0 font-semibold">結束顯示<input type="datetime-local" className={field} value={draft.endsAt} onChange={event => setDraft({ ...draft, endsAt: event.target.value })} /></label>
    </div>
    <p className="text-sm text-stone-600">時間以 {timeZone} 為準。開始留空為立即顯示，結束留空則持續顯示至關閉。</p>
    {message ? <p role="status" className="rounded-lg bg-stone-100 p-3 text-stone-800">{message}</p> : null}
    <div className="flex flex-wrap gap-3">
      <button type="button" className="min-h-11 rounded-lg border border-stone-300 px-5 py-3" onClick={() => setPreview(true)}>預覽公告</button>
      <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "儲存中…" : "儲存公告"}</button>
    </div>
    <ExperienceDialog open={preview} onClose={() => setPreview(false)} title={draft.title || "店家公告預覽"}>
      <p className="whitespace-pre-wrap leading-7 [overflow-wrap:anywhere]">{draft.content || "公告內容將顯示在這裡。"}</p>
      <button type="button" onClick={() => setPreview(false)} className="mt-6 min-h-12 w-full rounded-lg bg-teal-700 px-4 text-white">我知道了</button>
    </ExperienceDialog>
  </form>;
}
