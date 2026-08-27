"use client";

import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { AppLocale } from "@/lib/app-locale";
import { formatAppDate } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import type { SpecialClosureView } from "@/lib/special-closures-client";

type Draft = {
  range: boolean;
  startsOn: string;
  endsOn: string;
  title: string;
  message: string;
};

function emptyDraft(): Draft {
  return { range: false, startsOn: "", endsOn: "", title: "公休日", message: "" };
}

export function StallSpecialClosuresManager({
  stallId,
  initialClosures,
}: {
  stallId: string;
  initialClosures: SpecialClosureView[];
}) {
  const { locale, label } = useMerchantMessages();
  const [closures, setClosures] = useState(initialClosures);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  async function run(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    setHasError(false);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/special-closures`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(typeof payload.error === "string" ? label(payload.error) : label("目前無法更新特殊營業日。"));
        setHasError(true);
        return false;
      }
      setClosures(payload.closures as SpecialClosureView[]);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? label(error.message) : label("目前無法更新特殊營業日。"));
      setHasError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createClosure() {
    const created = await run({
      operation: "CREATE",
      startsOn: draft.startsOn,
      endsOn: draft.range ? draft.endsOn : draft.startsOn,
      title: draft.title,
      message: draft.message,
    }, label("公休公告已新增。"));
    if (created) setDraft(emptyDraft());
  }

  return (
    <section aria-labelledby="special-closures-heading" className="border-b border-stone-200 pb-6">
      <div className="flex min-h-14 items-center gap-3 py-3">
        <CalendarOff className="h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
        <div>
          <h2 id="special-closures-heading" className="text-lg font-semibold">{label("特殊營業日與公休公告")}</h2>
          <p className="mt-1 text-sm text-stone-600">{label("可設定單日或日期區間；公休期間 Menu 仍可查看，但無法送出訂單。")}</p>
        </div>
      </div>

      {message ? <p role={hasError ? "alert" : "status"} className={`mb-3 text-sm font-medium ${hasError ? "text-red-700" : "text-teal-800"}`}>{message}</p> : null}

      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex gap-2" role="group" aria-label={label("公休日期類型")}>
          <button type="button" aria-pressed={!draft.range} onClick={() => setDraft((current) => ({ ...current, range: false }))} className={`min-h-10 rounded-md border px-3 text-sm font-semibold ${!draft.range ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white"}`}>{label("單日公休")}</button>
          <button type="button" aria-pressed={draft.range} onClick={() => setDraft((current) => ({ ...current, range: true, endsOn: current.endsOn || current.startsOn }))} className={`min-h-10 rounded-md border px-3 text-sm font-semibold ${draft.range ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white"}`}>{label("日期區間")}</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-stone-600">{draft.range ? label("開始日期") : label("公休日期")}<input type="date" value={draft.startsOn} onChange={(event) => setDraft((current) => ({ ...current, startsOn: event.target.value, endsOn: current.endsOn || event.target.value }))} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>
          {draft.range ? <label className="text-xs font-semibold text-stone-600">{label("結束日期")}<input type="date" min={draft.startsOn || undefined} value={draft.endsOn} onChange={(event) => setDraft((current) => ({ ...current, endsOn: event.target.value }))} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label> : null}
          <label className="text-xs font-semibold text-stone-600">{label("公告標題")}<input type="text" maxLength={80} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>
          <label className="text-xs font-semibold text-stone-600 sm:col-span-2">{label("補充說明（選填）")}<textarea maxLength={240} value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} className="mt-1 min-h-24 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" /></label>
        </div>
        <button type="button" disabled={busy || !draft.startsOn || (draft.range && !draft.endsOn) || !draft.title.trim()} onClick={() => void createClosure()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4" />{label("新增公休公告")}</button>
      </div>

      <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
        {closures.map((closure) => (
          <article key={closure.id} className="flex items-start gap-3 py-4">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">{closure.title}</h3>
              <p className="mt-1 text-sm text-stone-700">{formatClosureRange(locale, closure)}</p>
              {closure.message ? <p className="mt-1 text-sm text-stone-500">{closure.message}</p> : null}
            </div>
            <button type="button" title={label("刪除公休公告")} disabled={busy} onClick={() => {
              if (window.confirm(label("確定刪除這筆公休公告？"))) {
                void run({ operation: "DELETE", closureId: closure.id }, label("公休公告已刪除。"));
              }
            }} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-red-300 text-red-700 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
          </article>
        ))}
        {closures.length === 0 ? <p className="py-5 text-sm text-stone-500">{label("尚未設定特殊公休日。")}</p> : null}
      </div>
    </section>
  );
}

function formatClosureRange(locale: AppLocale, closure: SpecialClosureView) {
  const start = formatAppDate(locale, new Date(`${closure.startsOn}T00:00:00.000Z`), { dateStyle: "medium", timeZone: "UTC" });
  if (closure.startsOn === closure.endsOn) return start;
  const end = formatAppDate(locale, new Date(`${closure.endsOn}T00:00:00.000Z`), { dateStyle: "medium", timeZone: "UTC" });
  return `${start} – ${end}`;
}
