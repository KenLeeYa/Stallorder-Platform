"use client";

import { CalendarOff, Clock3, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { AppLocale } from "@/lib/app-locale";
import { formatAppDate } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import {
  findOverlappingSpecialClosure,
  type SpecialClosureView,
} from "@/lib/special-closures-client";

type Draft = {
  mode: "CLOSED" | "OPEN_HOURS";
  startsOn: string;
  endsOn: string;
  opensAt: string;
  closesAt: string;
  title: string;
  message: string;
};

function emptyDraft(): Draft {
  return {
    mode: "CLOSED",
    startsOn: "",
    endsOn: "",
    opensAt: "15:00",
    closesAt: "19:00",
    title: "公休日",
    message: "",
  };
}

function draftFromClosure(closure: SpecialClosureView): Draft {
  return {
    mode: closure.opensAt && closure.closesAt ? "OPEN_HOURS" : "CLOSED",
    startsOn: closure.startsOn,
    endsOn: closure.endsOn,
    opensAt: closure.opensAt ?? "15:00",
    closesAt: closure.closesAt ?? "19:00",
    title: closure.title,
    message: closure.message,
  };
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingClosureId, setEditingClosureId] = useState<string | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  const normalizedEndsOn = draft.endsOn;
  const validDateRange = Boolean(draft.startsOn && draft.endsOn && draft.endsOn >= draft.startsOn);
  const overlappingClosure = validDateRange
    ? findOverlappingSpecialClosure(closures, draft.startsOn, normalizedEndsOn, editingClosureId)
    : null;
  const invalidTimeRange = draft.mode === "OPEN_HOURS"
    && (!draft.opensAt || !draft.closesAt || draft.closesAt <= draft.opensAt);
  const formInvalid = !validDateRange || invalidTimeRange || !draft.title.trim();

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

  function openCreateEditor() {
    setDraft(emptyDraft());
    setEditingClosureId(null);
    setDeleteConfirmationOpen(false);
    setMessage("");
    setHasError(false);
    setEditorOpen(true);
  }

  function openEditor(closure: SpecialClosureView) {
    setDraft(draftFromClosure(closure));
    setEditingClosureId(closure.id);
    setDeleteConfirmationOpen(false);
    setMessage("");
    setHasError(false);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (busy) return;
    setEditorOpen(false);
    setEditingClosureId(null);
    setDeleteConfirmationOpen(false);
    setDraft(emptyDraft());
    setMessage("");
    setHasError(false);
  }

  function resetEditor() {
    const existing = editingClosureId
      ? closures.find((closure) => closure.id === editingClosureId)
      : null;
    setDraft(existing ? draftFromClosure(existing) : emptyDraft());
    setMessage("");
    setHasError(false);
  }

  async function saveClosure() {
    if (!validDateRange) {
      setMessage(label(
        draft.startsOn && draft.endsOn
          ? "結束日期不得早於開始日期。"
          : "請先選擇開始與結束日期。",
      ));
      setHasError(true);
      return;
    }
    if (invalidTimeRange) {
      setMessage(label("結束時間必須晚於開始時間。"));
      setHasError(true);
      return;
    }
    if (overlappingClosure) {
      setMessage(label("此日期已設定特殊營業時間或店休，請直接修改既有設定。"));
      setHasError(true);
      return;
    }

    const saved = await run({
      operation: editingClosureId ? "UPDATE" : "CREATE",
      ...(editingClosureId ? { closureId: editingClosureId } : {}),
      startsOn: draft.startsOn,
      endsOn: normalizedEndsOn,
      opensAt: draft.mode === "OPEN_HOURS" ? draft.opensAt : null,
      closesAt: draft.mode === "OPEN_HOURS" ? draft.closesAt : null,
      title: draft.title,
      message: draft.message,
    }, label(editingClosureId ? "特殊營業日已更新。" : "特殊營業日已新增。"));
    if (saved) {
      setEditorOpen(false);
      setEditingClosureId(null);
      setDeleteConfirmationOpen(false);
      setDraft(emptyDraft());
    }
  }

  async function deleteClosure() {
    if (!editingClosureId) return;
    const deleted = await run(
      { operation: "DELETE", closureId: editingClosureId },
      label("特殊營業日已刪除。"),
    );
    setDeleteConfirmationOpen(false);
    if (deleted) {
      setEditorOpen(false);
      setEditingClosureId(null);
      setDraft(emptyDraft());
    }
  }

  return (
    <section aria-labelledby="special-closures-heading" className="border-b border-stone-200 pb-6">
      <div className="flex min-h-14 flex-wrap items-center gap-3 py-3">
        <CalendarOff className="h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="special-closures-heading" className="text-lg font-semibold">{label("特殊營業日與公休公告")}</h2>
          <p className="mt-1 text-sm text-stone-600">{label("可設定整日公休，或指定單日、多日的特殊營業時間。")}</p>
        </div>
        <button type="button" onClick={openCreateEditor} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white">
          <Plus className="h-5 w-5" aria-hidden="true" />
          {label("新增特殊營業日")}
        </button>
      </div>

      {message ? <p role={hasError ? "alert" : "status"} className={`mb-3 text-sm font-medium ${hasError ? "text-red-700" : "text-teal-800"}`}>{message}</p> : null}

      <div className="mt-3 grid gap-3">
        {closures.map((closure) => (
          <article key={closure.id}>
            <button type="button" disabled={busy} onClick={() => openEditor(closure)} className="flex min-h-20 w-full items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-500 disabled:opacity-40">
              <span className={`h-3 w-3 shrink-0 rounded-full ${closure.opensAt && closure.closesAt ? "bg-emerald-600" : "bg-red-600"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{closure.title}</span>
                <span className="mt-1 block text-sm text-stone-700">{formatClosureRange(locale, closure)}</span>
                {closure.message ? <span className="mt-1 block text-sm text-stone-500">{closure.message}</span> : null}
              </span>
              <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-semibold text-stone-700">
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {label("修改")}
              </span>
            </button>
          </article>
        ))}
        {closures.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 px-4 py-6 text-sm text-stone-500">{label("尚未設定特殊營業日或店休。")}</p> : null}
      </div>

      {editorOpen ? (
        <div className="fixed inset-0 z-[80] bg-black/50 sm:p-6">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="special-closure-editor-title"
            onSubmit={(event) => { event.preventDefault(); void saveClosure(); }}
            className="mx-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
          >
            <header className="flex shrink-0 items-start gap-3 border-b border-stone-200 px-4 py-4 sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-teal-700">{label(editingClosureId ? "編輯特殊營業日" : "新增特殊營業日")}</p>
                <h3 id="special-closure-editor-title" className="mt-1 text-2xl font-bold">{label("特殊營業時間／店休")}</h3>
              </div>
              <button type="button" onClick={closeEditor} disabled={busy} title={label("關閉編輯視窗")} aria-label={label("關閉編輯視窗")} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-stone-300 disabled:opacity-40">
                <X className="h-6 w-6" aria-hidden="true" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              {message ? <p role={hasError ? "alert" : "status"} className={`mb-4 rounded-lg px-3 py-2 text-sm font-medium ${hasError ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-800"}`}>{message}</p> : null}

              <h4 className="mb-3 text-lg font-bold text-stone-900">{label("日期區間")}</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-stone-700">{label("開始日期")}
                  <input type="date" required value={draft.startsOn} onChange={(event) => {
                    const startsOn = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      startsOn,
                      endsOn: !startsOn ? "" : (!current.endsOn || current.endsOn < startsOn ? startsOn : current.endsOn),
                    }));
                  }} className="mt-2 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base" />
                </label>
                <label className="text-sm font-semibold text-stone-700">{label("結束日期")}
                  <input type="date" required min={draft.startsOn || undefined} value={draft.endsOn} onChange={(event) => setDraft((current) => ({ ...current, endsOn: event.target.value }))} className="mt-2 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base" />
                </label>
              </div>
              <p className="mt-2 text-sm text-stone-500">{label("若為單日，請設定相同的開始和結束日期。")}</p>

              {overlappingClosure ? (
                <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {label("此日期已設定特殊營業時間或店休，請直接修改既有設定。")}
                </p>
              ) : null}

              <fieldset className="mt-6">
                <legend className="text-lg font-bold">{label("選擇營業時間類型")}</legend>
                <div className="mt-3 grid gap-3">
                  <button type="button" aria-pressed={draft.mode === "OPEN_HOURS"} onClick={() => setDraft((current) => ({ ...current, mode: "OPEN_HOURS", title: current.title === "公休日" ? "特殊營業時間" : current.title }))} className={`flex min-h-28 items-center gap-4 rounded-2xl border-2 p-4 text-left ${draft.mode === "OPEN_HOURS" ? "border-teal-700 bg-teal-50" : "border-stone-200 bg-white"}`}>
                    <span className="h-5 w-5 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />
                    <span><strong className="block text-lg">{label("營業")}</strong><span className="mt-1 block text-sm text-stone-600">{label("僅限特定時段")}</span></span>
                  </button>
                  <button type="button" aria-pressed={draft.mode === "CLOSED"} onClick={() => setDraft((current) => ({ ...current, mode: "CLOSED", title: current.title === "特殊營業時間" ? "公休日" : current.title }))} className={`flex min-h-28 items-center gap-4 rounded-2xl border-2 p-4 text-left ${draft.mode === "CLOSED" ? "border-teal-700 bg-teal-50" : "border-stone-200 bg-white"}`}>
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-600 text-xs font-bold text-white" aria-hidden="true">×</span>
                    <span><strong className="block text-lg">{label("關閉")}</strong><span className="mt-1 block text-sm text-stone-600">{label("僅限所選日期")}</span></span>
                  </button>
                </div>
              </fieldset>

              {draft.mode === "OPEN_HOURS" ? (
                <fieldset className="mt-6">
                  <legend className="flex items-center gap-2 text-lg font-bold"><Clock3 className="h-5 w-5" aria-hidden="true" />{label("營業時間")}</legend>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-sm font-semibold text-stone-700">{label("開始")}
                      <input type="time" required value={draft.opensAt} onChange={(event) => setDraft((current) => ({ ...current, opensAt: event.target.value }))} className="mt-2 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base" />
                    </label>
                    <label className="text-sm font-semibold text-stone-700">{label("結束")}
                      <input type="time" required value={draft.closesAt} onChange={(event) => setDraft((current) => ({ ...current, closesAt: event.target.value }))} className="mt-2 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base" />
                    </label>
                  </div>
                  {invalidTimeRange ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{label("結束時間必須晚於開始時間。")}</p> : null}
                </fieldset>
              ) : null}

              <div className="mt-6 grid gap-4">
                <label className="text-sm font-semibold text-stone-700">{label("公告標題")}
                  <input type="text" required maxLength={80} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="mt-2 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base" />
                </label>
                <label className="text-sm font-semibold text-stone-700">{label("補充說明（選填）")}
                  <textarea maxLength={240} value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} className="mt-2 min-h-24 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-base" />
                </label>
              </div>

              {editingClosureId ? (
                <button type="button" disabled={busy} onClick={() => {
                  setMessage("");
                  setHasError(false);
                  setDeleteConfirmationOpen(true);
                }} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl border border-red-300 px-4 font-semibold text-red-700 disabled:opacity-40">
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                  {label("刪除此設定")}
                </button>
              ) : null}
            </div>

            <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-stone-200 bg-white px-4 py-4 sm:px-6">
              <button type="button" disabled={busy} onClick={resetEditor} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-teal-700 font-semibold text-teal-800 disabled:opacity-40">
                <RotateCcw className="h-5 w-5" aria-hidden="true" />
                {label("重設")}
              </button>
              <button type="submit" disabled={busy || formInvalid || Boolean(overlappingClosure)} className="min-h-12 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-40">
                {label(editingClosureId ? "儲存變更" : "儲存")}
              </button>
            </footer>
          </form>

          {deleteConfirmationOpen ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-stone-950/65 p-4">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="special-closure-delete-title"
                aria-describedby="special-closure-delete-description"
                className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
              >
                <Trash2 className="h-9 w-9 text-red-700" aria-hidden="true" />
                <h3 id="special-closure-delete-title" className="mt-3 text-xl font-bold text-stone-950">
                  {label("確定刪除這筆特殊營業日設定？")}
                </h3>
                <p id="special-closure-delete-description" className="mt-2 text-sm leading-6 text-stone-600">
                  {label("刪除後，這段日期會恢復套用一般營業時間。")}
                </p>
                <p className="mt-4 rounded-xl bg-stone-100 px-4 py-3 text-sm font-semibold text-stone-800">
                  {draft.title} · {formatClosureRange(locale, {
                    id: editingClosureId ?? "",
                    startsOn: draft.startsOn,
                    endsOn: draft.endsOn,
                    opensAt: draft.mode === "OPEN_HOURS" ? draft.opensAt : null,
                    closesAt: draft.mode === "OPEN_HOURS" ? draft.closesAt : null,
                    title: draft.title,
                    message: draft.message,
                  })}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button type="button" autoFocus disabled={busy} onClick={() => setDeleteConfirmationOpen(false)} className="min-h-12 rounded-xl border-2 border-stone-300 px-4 font-semibold text-stone-800 disabled:opacity-40">
                    {label("取消")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void deleteClosure()} className="min-h-12 rounded-xl bg-red-700 px-4 font-semibold text-white disabled:opacity-40">
                    {label("確認刪除")}
                  </button>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatClosureRange(locale: AppLocale, closure: SpecialClosureView) {
  const start = formatAppDate(locale, new Date(`${closure.startsOn}T00:00:00.000Z`), { dateStyle: "medium", timeZone: "UTC" });
  const dates = closure.startsOn === closure.endsOn
    ? start
    : `${start} – ${formatAppDate(locale, new Date(`${closure.endsOn}T00:00:00.000Z`), { dateStyle: "medium", timeZone: "UTC" })}`;
  return closure.opensAt && closure.closesAt
    ? `${dates} · ${closure.opensAt}–${closure.closesAt}`
    : dates;
}
