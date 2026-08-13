"use client";

import { useRef, useState } from "react";
import { CalendarDays, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { AppLocale } from "@/lib/app-locale";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
  type FieldErrors,
} from "@/lib/form-field-errors";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

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
  const { locale, m, label } = useMerchantMessages();
  const managerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
    setHasError(false);
    setFieldErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  async function mutate(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/events`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const nextFieldErrors = Object.fromEntries(
          Object.entries(parseFieldErrors(payload.fieldErrors)).map(([field, error]) => [field, label(error)]),
        );
        setFieldErrors(nextFieldErrors);
        focusFirstInvalidField(managerRef.current, nextFieldErrors);
        setHasError(true);
        setMessage(typeof payload.error === "string" ? label(payload.error) : m("目前無法更新市集活動。"));
        return;
      }
      setData(payload);
      setMessage(successMessage);
      setConfirmDeleteId(null);
      setDeleteReason("");
      reset();
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? label(error.message) : m("目前無法更新市集活動。"));
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
      startsAt: toIsoDateTime(form.startsAt),
      endsAt: toIsoDateTime(form.endsAt),
      organizer: form.organizer.trim() || null,
      publicUrl: form.publicUrl.trim() || null,
      isPublic: form.isPublic,
    }, editingId ? m("活動已更新。") : m("活動已建立。"));
  }

  return (
    <div ref={managerRef} className="space-y-8">
      <section aria-labelledby="event-form-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4"><div><h2 id="event-form-title" className="flex items-center gap-2 text-xl font-semibold"><CalendarDays className="h-5 w-5 text-teal-700" />{editingId ? m("修改市集活動") : m("新增市集活動")}</h2><p className="mt-1 text-sm text-stone-600">{m("活動可供組織內多個攤位建立出攤行程。")}</p></div>{editingId ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><X className="h-4 w-4" />{m("取消編輯")}</button> : null}</div>
        {message ? <p role={hasError ? "alert" : "status"} className="mt-4 text-sm font-semibold text-stone-700">{message}</p> : null}
        <form noValidate onSubmit={(event) => void submit(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label={m("活動名稱")} field="name" error={fieldErrors.name}><input type="text" required maxLength={150} value={form.name} {...validationProps("name", fieldErrors.name)} onChange={(event) => { clearFieldError("name"); setForm({ ...form, name: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("活動代稱")} field="slug" error={fieldErrors.slug}><input type="text" required maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} {...validationProps("slug", fieldErrors.slug)} onChange={(event) => { clearFieldError("slug"); setForm({ ...form, slug: event.target.value.toLowerCase() }); }} className={inputClass} placeholder="weekend-market" /></Field>
          <Field label={m("場地名稱")} field="venueName" error={fieldErrors.venueName}><input type="text" required maxLength={150} value={form.venueName} {...validationProps("venueName", fieldErrors.venueName)} onChange={(event) => { clearFieldError("venueName"); setForm({ ...form, venueName: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("地址")} field="address" error={fieldErrors.address}><input type="text" required maxLength={300} value={form.address} {...validationProps("address", fieldErrors.address)} onChange={(event) => { clearFieldError("address"); setForm({ ...form, address: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("開始時間")} field="startsAt" error={fieldErrors.startsAt}><input required type="datetime-local" value={form.startsAt} {...validationProps("startsAt", fieldErrors.startsAt)} onChange={(event) => { clearFieldError("startsAt"); clearFieldError("endsAt"); setForm({ ...form, startsAt: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("結束時間")} field="endsAt" error={fieldErrors.endsAt}><input required type="datetime-local" value={form.endsAt} {...validationProps("endsAt", fieldErrors.endsAt)} onChange={(event) => { clearFieldError("endsAt"); setForm({ ...form, endsAt: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("緯度（選填）")} field="latitude" error={fieldErrors.latitude}><input type="number" inputMode="decimal" min={-90} max={90} step="any" value={form.latitude} {...validationProps("latitude", fieldErrors.latitude)} onChange={(event) => { clearFieldError("latitude"); clearFieldError("longitude"); setForm({ ...form, latitude: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("經度（選填）")} field="longitude" error={fieldErrors.longitude}><input type="number" inputMode="decimal" min={-180} max={180} step="any" value={form.longitude} {...validationProps("longitude", fieldErrors.longitude)} onChange={(event) => { clearFieldError("longitude"); clearFieldError("latitude"); setForm({ ...form, longitude: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("主辦單位（選填）")} field="organizer" error={fieldErrors.organizer}><input type="text" maxLength={150} value={form.organizer} {...validationProps("organizer", fieldErrors.organizer)} onChange={(event) => { clearFieldError("organizer"); setForm({ ...form, organizer: event.target.value }); }} className={inputClass} /></Field>
          <Field label={m("公開網址（選填）")} field="publicUrl" error={fieldErrors.publicUrl}><input type="url" maxLength={500} value={form.publicUrl} {...validationProps("publicUrl", fieldErrors.publicUrl)} onChange={(event) => { clearFieldError("publicUrl"); setForm({ ...form, publicUrl: event.target.value }); }} className={inputClass} placeholder="https://" /></Field>
          <Field label={m("活動說明（選填）")} field="description" error={fieldErrors.description} wide><textarea maxLength={1000} value={form.description} {...validationProps("description", fieldErrors.description)} onChange={(event) => { clearFieldError("description"); setForm({ ...form, description: event.target.value }); }} className="mt-1 min-h-24 w-full rounded-md border border-stone-300 p-3 text-sm" /></Field>
          <label className="flex min-h-11 flex-wrap items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.isPublic} {...validationProps("isPublic", fieldErrors.isPublic)} onChange={(event) => { clearFieldError("isPublic"); setForm({ ...form, isPublic: event.target.checked }); }} />{m("允許顧客在公開行程頁看到活動資訊")}{fieldErrors.isPublic ? <span id={fieldErrorId("isPublic")} role="alert" className="w-full text-xs text-red-700">{fieldErrors.isPublic}</span> : null}</label>
          <div className="sm:text-right"><button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? m("儲存活動") : m("新增活動")}</button></div>
        </form>
      </section>

      <section aria-labelledby="event-list-title"><h2 id="event-list-title" className="text-xl font-semibold">{m("市集活動")}</h2><div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{data.events.map((event) => <article key={event.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{event.name}</h3><span className="text-xs font-semibold text-stone-500">{event.isPublic ? m("公開") : m("內部")}</span></div><p className="mt-2 text-sm text-stone-600">{event.venueName} · {event.address}</p><p className="mt-1 text-sm text-stone-500">{formatRange(locale, event.startsAt, event.endsAt)}</p></div><div className="flex gap-2"><button type="button" title={m("修改活動")} onClick={() => edit(event)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button><button type="button" title={m("刪除活動")} onClick={() => setConfirmDeleteId(event.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-200 text-red-700"><Trash2 className="h-4 w-4" /></button></div></div>{confirmDeleteId === event.id ? <div className="mt-4 grid gap-3 border-l-2 border-red-500 pl-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><Field label={m("刪除原因")} field="reason" error={fieldErrors.reason}><input type="text" value={deleteReason} {...validationProps("reason", fieldErrors.reason)} onChange={(input) => { clearFieldError("reason"); setDeleteReason(input.target.value); }} minLength={3} maxLength={300} className={inputClass} /></Field><button type="button" disabled={busy} onClick={() => void mutate({ operation: "DELETE", eventId: event.id, reason: deleteReason }, m("活動已刪除。")) } className="min-h-10 rounded-md bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{m("確認刪除")}</button><button type="button" onClick={() => { setConfirmDeleteId(null); setDeleteReason(""); clearFieldError("reason"); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">{m("保留")}</button></div> : null}</article>)}{data.events.length === 0 ? <p className="py-8 text-sm text-stone-500">{m("尚未建立市集活動。")}</p> : null}</div></section>
    </div>
  );
}

function Field({ label, field, error, wide = false, children }: { label: string; field: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block text-xs font-semibold text-stone-600 ${wide ? "sm:col-span-2" : ""}`}>{label}{children}{error ? <span id={fieldErrorId(field)} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}

function validationProps(field: string, error?: string) {
  return {
    "data-field-key": field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? fieldErrorId(field) : undefined,
  };
}

function fieldErrorId(field: string) {
  return `market-event-${field}-error`;
}

function toIsoDateTime(value: string) {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatRange(locale: AppLocale, start: string, end: string) {
  const formatter = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${formatter.format(new Date(start))}～${formatter.format(new Date(end))}`;
}

const inputClass = "mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950";
