"use client";

import { useState } from "react";
import { CalendarDays, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

type EventView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  venueName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  startsAt: string;
  endsAt: string;
  organizer: string | null;
  publicUrl: string | null;
  isPublic: boolean;
};

type Data = { events: EventView[] };
const emptyForm = {
  name: "",
  slug: "",
  description: "",
  venueName: "",
  address: "",
  latitude: "",
  longitude: "",
  startsAt: "",
  endsAt: "",
  organizer: "",
  publicUrl: "",
  isPublic: true,
};

export function MarketEventManager({ organizationId, initialData }: { organizationId: string; initialData: Data }) {
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function edit(event: EventView) {
    setEditingId(event.id);
    setForm({
      name: event.name,
      slug: event.slug,
      description: event.description ?? "",
      venueName: event.venueName,
      address: event.address,
      latitude: event.latitude?.toString() ?? "",
      longitude: event.longitude?.toString() ?? "",
      startsAt: toDateTimeLocal(event.startsAt),
      endsAt: toDateTimeLocal(event.endsAt),
      organizer: event.organizer ?? "",
      publicUrl: event.publicUrl ?? "",
      isPublic: event.isPublic,
    });
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function mutate(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/events`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新市集活動。");
      setData(payload);
      setMessage(successMessage);
      setConfirmDeleteId(null);
      setDeleteReason("");
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新市集活動。");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await mutate({
      operation: editingId ? "UPDATE" : "CREATE",
      ...(editingId ? { eventId: editingId } : {}),
      name: form.name,
      slug: form.slug,
      description: form.description.trim() || null,
      venueName: form.venueName,
      address: form.address,
      latitude: form.latitude.trim() ? Number(form.latitude) : null,
      longitude: form.longitude.trim() ? Number(form.longitude) : null,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      organizer: form.organizer.trim() || null,
      publicUrl: form.publicUrl.trim() || null,
      isPublic: form.isPublic,
    }, editingId ? "活動已更新。" : "活動已建立。");
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="event-form-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4"><div><h2 id="event-form-title" className="flex items-center gap-2 text-xl font-semibold"><CalendarDays className="h-5 w-5 text-teal-700" />{editingId ? "修改市集活動" : "新增市集活動"}</h2><p className="mt-1 text-sm text-stone-600">活動可供組織內多個攤位建立出攤行程。</p></div>{editingId ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><X className="h-4 w-4" />取消編輯</button> : null}</div>
        {message ? <p role="status" className="mt-4 text-sm font-semibold text-stone-700">{message}</p> : null}
        <form onSubmit={(event) => void submit(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="活動名稱"><input required maxLength={150} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></Field>
          <Field label="活動代稱"><input required maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })} className={inputClass} placeholder="weekend-market" /></Field>
          <Field label="場地名稱"><input required maxLength={150} value={form.venueName} onChange={(event) => setForm({ ...form, venueName: event.target.value })} className={inputClass} /></Field>
          <Field label="地址"><input required maxLength={300} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className={inputClass} /></Field>
          <Field label="開始時間"><input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className={inputClass} /></Field>
          <Field label="結束時間"><input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className={inputClass} /></Field>
          <Field label="緯度（選填）"><input inputMode="decimal" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} className={inputClass} /></Field>
          <Field label="經度（選填）"><input inputMode="decimal" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} className={inputClass} /></Field>
          <Field label="主辦單位（選填）"><input maxLength={150} value={form.organizer} onChange={(event) => setForm({ ...form, organizer: event.target.value })} className={inputClass} /></Field>
          <Field label="公開網址（選填）"><input type="url" maxLength={500} value={form.publicUrl} onChange={(event) => setForm({ ...form, publicUrl: event.target.value })} className={inputClass} placeholder="https://" /></Field>
          <label className="block text-xs font-semibold text-stone-600 sm:col-span-2">活動說明（選填）<textarea maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 min-h-24 w-full rounded-md border border-stone-300 p-3 text-sm" /></label>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.isPublic} onChange={(event) => setForm({ ...form, isPublic: event.target.checked })} />允許顧客在公開行程頁看到活動資訊</label>
          <div className="sm:text-right"><button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? "儲存活動" : "新增活動"}</button></div>
        </form>
      </section>

      <section aria-labelledby="event-list-title"><h2 id="event-list-title" className="text-xl font-semibold">市集活動</h2><div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{data.events.map((event) => <article key={event.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{event.name}</h3><span className="text-xs font-semibold text-stone-500">{event.isPublic ? "公開" : "內部"}</span></div><p className="mt-2 text-sm text-stone-600">{event.venueName} · {event.address}</p><p className="mt-1 text-sm text-stone-500">{formatRange(event.startsAt, event.endsAt)}</p></div><div className="flex gap-2"><button type="button" title="修改活動" onClick={() => edit(event)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button><button type="button" title="刪除活動" onClick={() => setConfirmDeleteId(event.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-200 text-red-700"><Trash2 className="h-4 w-4" /></button></div></div>{confirmDeleteId === event.id ? <div className="mt-4 grid gap-3 border-l-2 border-red-500 pl-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><Field label="刪除原因"><input value={deleteReason} onChange={(input) => setDeleteReason(input.target.value)} minLength={3} maxLength={300} className={inputClass} /></Field><button type="button" disabled={busy || deleteReason.trim().length < 3} onClick={() => void mutate({ operation: "DELETE", eventId: event.id, reason: deleteReason }, "活動已刪除。") } className="min-h-10 rounded-md bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">確認刪除</button><button type="button" onClick={() => { setConfirmDeleteId(null); setDeleteReason(""); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">保留</button></div> : null}</article>)}{data.events.length === 0 ? <p className="py-8 text-sm text-stone-500">尚未建立市集活動。</p> : null}</div></section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-stone-600">{label}{children}</label>;
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${formatter.format(new Date(start))}～${formatter.format(new Date(end))}`;
}

const inputClass = "mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950";
