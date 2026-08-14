"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, RefreshCw } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppNumber } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

type SectionKey = "PAYMENTS" | "DISCOUNTS" | "ORDERING_EXPERIENCE" | "PRODUCT_AVAILABILITY" | "BUSINESS_HOURS";
type Preview = {
  sourceStall: { id: string; name: string };
  targetStall: { id: string; name: string };
  sections: Array<{ key: SectionKey; label: string; changed: boolean; sourceCount: number; targetCount: number; changes: string[] }>;
};

export function StallTemplateCopyManager({ stallId, sourceStalls }: { stallId: string; sourceStalls: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const { locale, m, label } = useMerchantMessages();
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
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("目前無法比較攤位設定。"));
      setPreview(payload.preview);
      setSelected(new Set(payload.preview.sections.filter((section: Preview["sections"][number]) => section.changed).map((section: Preview["sections"][number]) => section.key)));
    } catch (error) {
      setMessage(error instanceof Error ? label(error.message) : m("目前無法比較攤位設定。"));
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate() {
    if (!preview || selected.size === 0) return;
    const labels = new Intl.ListFormat(locale).format(
      preview.sections.filter((section) => selected.has(section.key)).map((section) => label(section.label)),
    );
    if (!window.confirm(m("將以「{source}」覆蓋目前攤位的 {sections}。確定套用？", { source: preview.sourceStall.name, sections: labels }))) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/templates`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ sourceStallId, sections: [...selected] }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("目前無法套用攤位範本。"));
      setPreview(payload.preview);
      setSelected(new Set());
      setMessage(m("攤位範本已套用，相關設定已重新載入。"));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? label(error.message) : m("目前無法套用攤位範本。"));
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

  return <section aria-labelledby="stall-template-heading" data-settings-section data-settings-scope="stall-template" data-settings-search={m("多攤位範本 複製 付款 折扣 店員外送 預約 抽抽樂 商品供應 營業時間 差異預覽")} className="border-b border-stone-200">
    <div className="flex min-h-14 items-center gap-3 py-3 text-left">
      <Copy aria-hidden="true" className="h-5 w-5 shrink-0 text-teal-700" />
      <div className="min-w-0 flex-1">
        <h2 id="stall-template-heading" className="text-lg font-semibold">{m("多攤位範本")}</h2>
        <p className="mt-1 text-sm text-stone-600">{m("先顯示差異，再選擇要覆蓋的設定。")}</p>
      </div>
    </div>
    <div className="pb-6">
      {sourceStalls.length === 0 ? <p className="text-sm text-stone-500">{m("目前沒有其他可管理的攤位可作為範本。")}</p> : <div className="flex flex-wrap items-end gap-3"><label className="min-w-60 flex-1 text-xs font-semibold text-stone-600">{m("來源攤位")}<select value={sourceStallId} onChange={(event) => { setSourceStallId(event.target.value); setPreview(null); setSelected(new Set()); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{sourceStalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}</select></label><button type="button" disabled={busy || !sourceStallId} onClick={() => void loadPreview()} className="inline-flex h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}{m("比較差異")}</button></div>}
      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      {preview ? <div className="mt-5"><div className="divide-y divide-stone-200 border-y border-stone-200">{preview.sections.map((section) => <label key={section.key} className="grid cursor-pointer gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"><input type="checkbox" checked={selected.has(section.key)} disabled={!section.changed} onChange={(event) => toggle(section.key, event.target.checked)} className="mt-1 h-4 w-4" /><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{label(section.label)}</strong><span className={`text-xs font-semibold ${section.changed ? "text-amber-800" : "text-emerald-700"}`}>{section.changed ? m("{count} 項差異", { count: formatAppNumber(locale, section.changes.length) }) : m("設定相同")}</span></div>{section.changes.length > 0 ? <ul className="mt-2 space-y-1 text-xs text-stone-600">{section.changes.slice(0, 8).map((change) => <li key={change}>• {label(change)}</li>)}{section.changes.length > 8 ? <li>{m("另有 {count} 項差異", { count: formatAppNumber(locale, section.changes.length - 8) })}</li> : null}</ul> : null}</div><span className="text-xs text-stone-500">{m("來源 {source} · 目前 {current}", { source: formatAppNumber(locale, section.sourceCount), current: formatAppNumber(locale, section.targetCount) })}</span></label>)}</div><button type="button" disabled={busy || selected.size === 0} onClick={() => void applyTemplate()} className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{m("套用所選設定")}</button></div> : null}
    </div>
  </section>;
}
