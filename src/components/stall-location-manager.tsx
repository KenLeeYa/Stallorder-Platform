"use client";

import { useRef, useState } from "react";
import { MapPin, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";
import { formatAppNumber } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

type LocationView = {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  mapUrl: string | null;
  instructions: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Data = {
  stall: { id: string; name: string; timezone: string };
  capabilities: { locationLimit: number | null; multipleLocations: boolean };
  locations: LocationView[];
};

const emptyForm = {
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  mapUrl: "",
  instructions: "",
  isActive: true,
};

export function StallLocationManager({ stallId, initialData }: { stallId: string; initialData: Data }) {
  const { locale, m, label } = useMerchantMessages();
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const managerRef = useRef<HTMLDivElement>(null);

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  function edit(location: LocationView) {
    setEditingId(location.id);
    setForm({
      name: location.name,
      address: location.address,
      latitude: location.latitude?.toString() ?? "",
      longitude: location.longitude?.toString() ?? "",
      mapUrl: location.mapUrl ?? "",
      instructions: location.instructions ?? "",
      isActive: location.isActive,
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

  async function mutate(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/locations`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as { error?: string; fieldErrors?: unknown } & Data;
      if (!response.ok) {
        const nextFieldErrors = Object.fromEntries(
          Object.entries(parseFieldErrors(payload.fieldErrors)).map(([field, error]) => [field, label(error)]),
        );
        setFieldErrors(nextFieldErrors);
        setMessage(typeof payload.error === "string" ? label(payload.error) : m("目前無法更新地點。"));
        setHasError(true);
        focusFirstInvalidField(managerRef.current, nextFieldErrors);
        return;
      }
      setData(payload);
      setMessage(successMessage);
      setConfirmDeleteId(null);
      setDeleteReason("");
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? label(error.message) : m("目前無法更新地點。"));
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const latitude = form.latitude.trim() ? Number(form.latitude) : null;
    const longitude = form.longitude.trim() ? Number(form.longitude) : null;
    await mutate({
      operation: editingId ? "UPDATE" : "CREATE",
      ...(editingId ? { locationId: editingId } : {}),
      name: form.name,
      address: form.address,
      latitude,
      longitude,
      mapUrl: form.mapUrl.trim() || null,
      instructions: form.instructions.trim() || null,
      isActive: form.isActive,
    }, editingId ? m("地點已更新。") : m("地點已建立。"));
  }

  const limitReached = data.capabilities.locationLimit !== null
    && data.locations.length >= data.capabilities.locationLimit;

  return (
    <div ref={managerRef} className="space-y-8">
      <section aria-labelledby="location-form-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
          <div><h2 id="location-form-title" className="flex items-center gap-2 text-xl font-semibold"><MapPin className="h-5 w-5 text-teal-700" />{editingId ? m("修改常用地點") : m("新增常用地點")}</h2><p className="mt-1 text-sm text-stone-600">{data.capabilities.locationLimit ? m("目前 {count} / {limit} 個地點", { count: formatAppNumber(locale, data.locations.length), limit: formatAppNumber(locale, data.capabilities.locationLimit) }) : m("目前 {count} 個地點", { count: formatAppNumber(locale, data.locations.length) })}</p></div>
          {editingId ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><X className="h-4 w-4" />{m("取消編輯")}</button> : null}
        </div>
        {message ? <p role={hasError ? "alert" : "status"} className={`mt-4 text-sm font-semibold ${hasError ? "text-red-700" : "text-stone-700"}`}>{message}</p> : null}
        {limitReached && !editingId ? <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-amber-800">{m("目前方案的地點數量已達上限。")}</p> : null}
        <form noValidate onSubmit={(event) => void submit(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label={m("地點名稱")} field="name" error={fieldErrors.name}><input {...validationProps("name", fieldErrors.name)} type="text" required maxLength={100} value={form.name} onChange={(event) => { clearFieldError("name"); setForm({ ...form, name: event.target.value }); }} className={inputClass(fieldErrors.name)} /></Field>
          <Field label={m("地址")} field="address" error={fieldErrors.address}><input {...validationProps("address", fieldErrors.address)} type="text" required maxLength={300} value={form.address} onChange={(event) => { clearFieldError("address"); setForm({ ...form, address: event.target.value }); }} className={inputClass(fieldErrors.address)} /></Field>
          <Field label={m("緯度（選填）")} field="latitude" error={fieldErrors.latitude}><input {...validationProps("latitude", fieldErrors.latitude)} type="number" inputMode="decimal" min={-90} max={90} step="any" value={form.latitude} onChange={(event) => { clearFieldError("latitude"); setForm({ ...form, latitude: event.target.value }); }} className={inputClass(fieldErrors.latitude)} placeholder="25.056000" /></Field>
          <Field label={m("經度（選填）")} field="longitude" error={fieldErrors.longitude}><input {...validationProps("longitude", fieldErrors.longitude)} type="number" inputMode="decimal" min={-180} max={180} step="any" value={form.longitude} onChange={(event) => { clearFieldError("longitude"); setForm({ ...form, longitude: event.target.value }); }} className={inputClass(fieldErrors.longitude)} placeholder="121.515000" /></Field>
          <Field label={m("地圖網址（選填）")} field="mapUrl" error={fieldErrors.mapUrl}><input {...validationProps("mapUrl", fieldErrors.mapUrl)} type="url" maxLength={500} value={form.mapUrl} onChange={(event) => { clearFieldError("mapUrl"); setForm({ ...form, mapUrl: event.target.value }); }} className={inputClass(fieldErrors.mapUrl)} placeholder="https://" /></Field>
          <Field label={m("到場說明（選填）")} field="instructions" error={fieldErrors.instructions}><input {...validationProps("instructions", fieldErrors.instructions)} type="text" maxLength={500} value={form.instructions} onChange={(event) => { clearFieldError("instructions"); setForm({ ...form, instructions: event.target.value }); }} className={inputClass(fieldErrors.instructions)} /></Field>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />{m("啟用此地點")}</label>
          <div className="sm:text-right"><button type="submit" disabled={busy || (limitReached && !editingId)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? m("儲存地點") : m("新增地點")}</button></div>
        </form>
      </section>

      <section aria-labelledby="location-list-title">
        <h2 id="location-list-title" className="text-xl font-semibold">{m("常用地點")}</h2>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {data.locations.map((location) => (
            <article key={location.id} className="py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><div className="flex items-center gap-2"><h3 className="font-semibold">{location.name}</h3><span className={`text-xs font-semibold ${location.isActive ? "text-teal-700" : "text-stone-400"}`}>{location.isActive ? m("啟用") : m("停用")}</span></div><p className="mt-2 text-sm text-stone-600">{location.address}</p>{location.instructions ? <p className="mt-1 text-sm text-stone-500">{location.instructions}</p> : null}</div>
                <div className="flex gap-2"><button type="button" title={m("修改地點")} onClick={() => edit(location)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button><button type="button" title={m("刪除地點")} onClick={() => setConfirmDeleteId(location.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-200 text-red-700"><Trash2 className="h-4 w-4" /></button></div>
              </div>
              {confirmDeleteId === location.id ? <div className="mt-4 grid gap-3 border-l-2 border-red-500 pl-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><Field label={m("刪除原因")} field="reason" error={fieldErrors.reason}><input {...validationProps("reason", fieldErrors.reason)} type="text" value={deleteReason} onChange={(event) => { clearFieldError("reason"); setDeleteReason(event.target.value); }} className={inputClass(fieldErrors.reason)} minLength={3} maxLength={300} /></Field><button type="button" disabled={busy} onClick={() => void mutate({ operation: "DELETE", locationId: location.id, reason: deleteReason }, m("地點已刪除。")) } className="min-h-10 rounded-md bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{m("確認刪除")}</button><button type="button" onClick={() => { setConfirmDeleteId(null); setDeleteReason(""); setFieldErrors({}); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">{m("保留")}</button></div> : null}
            </article>
          ))}
          {data.locations.length === 0 ? <p className="py-8 text-sm text-stone-500">{m("尚未建立常用地點。")}</p> : null}
        </div>
      </section>
    </div>
  );
}

function Field({ label, field, error, children }: { label: string; field: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-stone-600">{label}{children}{error ? <span id={fieldErrorId(field)} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}

function validationProps(field: string, error?: string) {
  return {
    "data-field-key": field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? fieldErrorId(field) : undefined,
  };
}

function fieldErrorId(field: string) {
  return `stall-location-${field}-error`;
}

function inputClass(error?: string) {
  return `mt-1 h-11 w-full rounded-md border bg-white px-3 text-sm text-stone-950 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`;
}
