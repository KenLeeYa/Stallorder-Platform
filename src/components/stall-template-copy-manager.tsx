"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, RefreshCw } from "lucide-react";
import { CollapsibleSectionSummary } from "@/components/collapsible-section-summary";
import { csrfHeaders } from "@/lib/csrf-client";

type SectionKey = "PAYMENTS" | "DISCOUNTS" | "PRODUCT_AVAILABILITY" | "BUSINESS_HOURS";
type Preview = {
  sourceStall: { id: string; name: string };
  targetStall: { id: string; name: string };
  sections: Array<{ key: SectionKey; label: string; changed: boolean; sourceCount: number; targetCount: number; changes: string[] }>;
};

export function StallTemplateCopyManager({ stallId, sourceStalls }: { stallId: string; sourceStalls: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [sourceStallId, setSourceStallId] = useState(sourceStalls[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<SectionKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPreview() {
    if (!sourceStallId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/templates?sourceStallId=${encodeURIComponent(sourceStallId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法比較攤位設定。");
      setPreview(payload.preview);
      setSelected(new Set(payload.preview.sections.filter((section: Preview["sections"][number]) => section.changed).map((section: Preview["sections"][number]) => section.key)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法比較攤位設定。");
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate() {
    if (!preview || selected.size === 0) return;
    const labels = preview.sections.filter((section) => selected.has(section.key)).map((section) => section.label).join("、");
    if (!window.confirm(`將以「${preview.sourceStall.name}」覆蓋目前攤位的${labels}。確定套用？`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/templates`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ sourceStallId, sections: [...selected] }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法套用攤位範本。");
      setPreview(payload.preview);
      setSelected(new Set());
      setMessage("攤位範本已套用，相關設定已重新載入。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法套用攤位範本。");
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: SectionKey, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }

  return <details data-settings-section data-settings-scope="stall-template" data-settings-search="多攤位範本 複製 付款 折扣 商品供應 營業時間 差異預覽" className="border-b border-stone-200 [&[open]>summary_.section-chevron]:rotate-180">
    <CollapsibleSectionSummary icon={Copy} title="多攤位範本" description="先顯示差異，再選擇要覆蓋的設定。" />
    <div className="pb-6">
      {sourceStalls.length === 0 ? <p className="text-sm text-stone-500">目前沒有其他可管理的攤位可作為範本。</p> : <div className="flex flex-wrap items-end gap-3"><label className="min-w-60 flex-1 text-xs font-semibold text-stone-600">來源攤位<select value={sourceStallId} onChange={(event) => { setSourceStallId(event.target.value); setPreview(null); setSelected(new Set()); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{sourceStalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}</select></label><button type="button" disabled={busy || !sourceStallId} onClick={() => void loadPreview()} className="inline-flex h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}比較差異</button></div>}
      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      {preview ? <div className="mt-5"><div className="divide-y divide-stone-200 border-y border-stone-200">{preview.sections.map((section) => <label key={section.key} className="grid cursor-pointer gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"><input type="checkbox" checked={selected.has(section.key)} disabled={!section.changed} onChange={(event) => toggle(section.key, event.target.checked)} className="mt-1 h-4 w-4" /><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{section.label}</strong><span className={`text-xs font-semibold ${section.changed ? "text-amber-800" : "text-emerald-700"}`}>{section.changed ? `${section.changes.length} 項差異` : "設定相同"}</span></div>{section.changes.length > 0 ? <ul className="mt-2 space-y-1 text-xs text-stone-600">{section.changes.slice(0, 8).map((change) => <li key={change}>• {change}</li>)}{section.changes.length > 8 ? <li>另有 {section.changes.length - 8} 項差異</li> : null}</ul> : null}</div><span className="text-xs text-stone-500">來源 {section.sourceCount} · 目前 {section.targetCount}</span></label>)}</div><button type="button" disabled={busy || selected.size === 0} onClick={() => void applyTemplate()} className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />套用所選設定</button></div> : null}
    </div>
  </details>;
}
