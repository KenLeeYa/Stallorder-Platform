"use client";

import { useState } from "react";
import { MapPin, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

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
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
      const response = await fetch(`/api/merchant/stalls/${stallId}/locations`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新地點。");
      setData(payload);
      setMessage(successMessage);
      setConfirmDeleteId(null);
      setDeleteReason("");
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新地點。");
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
    }, editingId ? "地點已更新。" : "地點已建立。");
  }

  const limitReached = data.capabilities.locationLimit !== null
    && data.locations.length >= data.capabilities.locationLimit;

  return (
    <div className="space-y-8">
      <section aria-labelledby="location-form-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
          <div><h2 id="location-form-title" className="flex items-center gap-2 text-xl font-semibold"><MapPin className="h-5 w-5 text-teal-700" />{editingId ? "修改常用地點" : "新增常用地點"}</h2><p className="mt-1 text-sm text-stone-600">目前 {data.locations.length}{data.capabilities.locationLimit ? ` / ${data.capabilities.locationLimit}` : ""} 個地點</p></div>
          {editingId ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><X className="h-4 w-4" />取消編輯</button> : null}
        </div>
        {message ? <p role="status" className="mt-4 text-sm font-semibold text-stone-700">{message}</p> : null}
        {limitReached && !editingId ? <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-amber-800">目前方案的地點數量已達上限。</p> : null}
        <form onSubmit={(event) => void submit(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="地點名稱"><input type="text" required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></Field>
          <Field label="地址"><input type="text" required maxLength={300} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className={inputClass} /></Field>
          <Field label="緯度（選填）"><input type="number" inputMode="decimal" min={-90} max={90} step="any" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} className={inputClass} placeholder="25.056000" /></Field>
          <Field label="經度（選填）"><input type="number" inputMode="decimal" min={-180} max={180} step="any" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} className={inputClass} placeholder="121.515000" /></Field>
          <Field label="地圖網址（選填）"><input type="url" maxLength={500} value={form.mapUrl} onChange={(event) => setForm({ ...form, mapUrl: event.target.value })} className={inputClass} placeholder="https://" /></Field>
          <Field label="到場說明（選填）"><input type="text" maxLength={500} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} className={inputClass} /></Field>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />啟用此地點</label>
          <div className="sm:text-right"><button type="submit" disabled={busy || (limitReached && !editingId)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? "儲存地點" : "新增地點"}</button></div>
        </form>
      </section>

      <section aria-labelledby="location-list-title">
        <h2 id="location-list-title" className="text-xl font-semibold">常用地點</h2>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {data.locations.map((location) => (
            <article key={location.id} className="py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><div className="flex items-center gap-2"><h3 className="font-semibold">{location.name}</h3><span className={`text-xs font-semibold ${location.isActive ? "text-teal-700" : "text-stone-400"}`}>{location.isActive ? "啟用" : "停用"}</span></div><p className="mt-2 text-sm text-stone-600">{location.address}</p>{location.instructions ? <p className="mt-1 text-sm text-stone-500">{location.instructions}</p> : null}</div>
                <div className="flex gap-2"><button type="button" title="修改地點" onClick={() => edit(location)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button><button type="button" title="刪除地點" onClick={() => setConfirmDeleteId(location.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-200 text-red-700"><Trash2 className="h-4 w-4" /></button></div>
              </div>
              {confirmDeleteId === location.id ? <div className="mt-4 grid gap-3 border-l-2 border-red-500 pl-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><Field label="刪除原因"><input type="text" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} className={inputClass} minLength={3} maxLength={300} /></Field><button type="button" disabled={busy || deleteReason.trim().length < 3} onClick={() => void mutate({ operation: "DELETE", locationId: location.id, reason: deleteReason }, "地點已刪除。") } className="min-h-10 rounded-md bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">確認刪除</button><button type="button" onClick={() => { setConfirmDeleteId(null); setDeleteReason(""); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">保留</button></div> : null}
            </article>
          ))}
          {data.locations.length === 0 ? <p className="py-8 text-sm text-stone-500">尚未建立常用地點。</p> : null}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-stone-600">{label}{children}</label>;
}

const inputClass = "mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950";
