"use client";

import { useCallback, useState, type ReactNode } from "react";
import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

type Assignment = { id: string; category: { id: string; name: string } | null; product: { id: string; name: string } | null };
type Station = { id: string; name: string; code: string; description: string | null; sortOrder: number; isActive: boolean; taskCount: number; assignments: Assignment[] };
type Data = {
  stations: Station[];
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; categoryId: string }>;
  maxStations: number | null;
};

export function KitchenStationsManager({ stallSlug, initialData }: { stallSlug: string; initialData: Data }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({ name: "", code: "", description: "", sortOrder: data.stations.length, isActive: true });

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stalls/${stallSlug}/kitchen/stations`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "無法重新載入工作站設定。");
    setData(payload);
  }, [stallSlug]);

  async function mutate(command: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stallSlug}/kitchen/stations`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify(command) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "工作站設定失敗。");
      await refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "工作站設定失敗。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createStation() {
    const created = await mutate({ operation: "CREATE_STATION", name: draft.name, code: draft.code.toUpperCase(), description: draft.description.trim() || null, sortOrder: draft.sortOrder, isActive: draft.isActive });
    if (created) setDraft({ name: "", code: "", description: "", sortOrder: data.stations.length + 1, isActive: true });
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-6">
      <div className="border-b border-stone-200 pb-5"><h2 className="text-2xl font-semibold">工作站與品項分流</h2><p className="mt-2 text-sm text-stone-600">商品指定優先於分類；未分派品項會進入綜合工作站。</p></div>
      {message ? <p role="alert" className="mt-4 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p> : null}
      <section className="border-b border-stone-200 py-6">
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">新增工作站</h3><span className="text-sm text-stone-500">{data.stations.length} / {data.maxStations ?? "不限"}</span></div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="名稱"><input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="form-input" placeholder="炸台" /></Field>
          <Field label="代碼"><input value={draft.code} maxLength={32} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} className="form-input font-mono" placeholder="FRY" /></Field>
          <Field label="說明"><input value={draft.description} maxLength={300} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="form-input" placeholder="油炸類餐點" /></Field>
          <Field label="排序"><input type="number" min={0} max={10000} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className="form-input" /></Field>
        </div>
        <button type="button" disabled={busy || !draft.name.trim() || !draft.code.trim()} onClick={() => void createStation()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}新增工作站</button>
      </section>

      <div className="space-y-5 py-6">
        {data.stations.map((station) => <StationEditor key={station.id} station={station} categories={data.categories} products={data.products} busy={busy} mutate={mutate} />)}
      </div>
    </main>
  );
}

function StationEditor({ station, categories, products, busy, mutate }: { station: Station; categories: Data["categories"]; products: Data["products"]; busy: boolean; mutate: (command: Record<string, unknown>) => Promise<boolean> }) {
  const [draft, setDraft] = useState({ name: station.name, code: station.code, description: station.description ?? "", sortOrder: station.sortOrder, isActive: station.isActive });
  const [targetType, setTargetType] = useState<"CATEGORY" | "PRODUCT">("CATEGORY");
  const [targetId, setTargetId] = useState(categories[0]?.id ?? "");
  async function createAssignment() {
    if (!targetId) return;
    await mutate({ operation: "CREATE_ASSIGNMENT", stationId: station.id, categoryId: targetType === "CATEGORY" ? targetId : null, productId: targetType === "PRODUCT" ? targetId : null });
  }
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{station.name}</h3><p className="mt-1 font-mono text-xs text-stone-500">{station.code} · {station.taskCount} 筆歷史工作</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${station.isActive ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>{station.isActive ? "啟用" : "停用"}</span></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="名稱"><input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="form-input" /></Field>
        <Field label="代碼"><input value={draft.code} disabled={station.code === "DEFAULT"} maxLength={32} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} className="form-input font-mono disabled:bg-stone-100" /></Field>
        <Field label="說明"><input value={draft.description} maxLength={300} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="form-input" /></Field>
        <Field label="排序"><input type="number" min={0} max={10000} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className="form-input" /></Field>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />啟用此工作站</label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void mutate({ operation: "UPDATE_STATION", stationId: station.id, ...draft, description: draft.description.trim() || null })} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存</button>{station.code !== "DEFAULT" ? <button type="button" disabled={busy} onClick={() => { if (window.confirm(`確定刪除工作站「${station.name}」？`)) void mutate({ operation: "DELETE_STATION", stationId: station.id }); }} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"><Trash2 className="h-4 w-4" />刪除</button> : null}</div>

      <div className="mt-6 border-t border-stone-200 pt-5"><h4 className="font-semibold">分派規則</h4><div className="mt-3 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)_auto]"><select value={targetType} onChange={(event) => { const next = event.target.value as "CATEGORY" | "PRODUCT"; setTargetType(next); setTargetId(next === "CATEGORY" ? categories[0]?.id ?? "" : products[0]?.id ?? ""); }} className="h-11 rounded-md border border-stone-300 bg-white px-3"><option value="CATEGORY">商品分類</option><option value="PRODUCT">指定商品</option></select><select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3">{(targetType === "CATEGORY" ? categories : products).map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select><button type="button" disabled={busy || !targetId} onClick={() => void createAssignment()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50"><Plus className="h-4 w-4" />分派</button></div>
        <div className="mt-3 divide-y divide-stone-100 border-y border-stone-100">{station.assignments.map((assignment) => <div key={assignment.id} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm"><span><strong>{assignment.product ? "商品" : "分類"}</strong> · {assignment.product?.name ?? assignment.category?.name}</span><button type="button" title="刪除分派" disabled={busy} onClick={() => void mutate({ operation: "DELETE_ASSIGNMENT", assignmentId: assignment.id })} className="grid h-9 w-9 place-items-center rounded-md text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></div>)}</div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-sm font-medium text-stone-700">{label}<span className="mt-1 block">{children}</span></label>;
}
