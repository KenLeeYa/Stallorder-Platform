"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

type StallDraft = {
  name: string;
  code: string;
  slug?: string;
  description: string;
  address: string;
  phone: string;
  timezone: string;
  currency: string;
  businessStatus?: "OPEN" | "PAUSED" | "CLOSED" | "SOLD_OUT";
  orderingEnabled?: boolean;
  isActive?: boolean;
};

export function StallEditor({
  organizationId,
  stallId,
  initial,
}: {
  organizationId: string;
  stallId?: string;
  initial: StallDraft;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isEditing = Boolean(stallId);

  function update<K extends keyof StallDraft>(key: K, value: StallDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    let confirmation: "DEACTIVATE" | undefined;
    if (isEditing && draft.isActive === false) {
      const confirmed = window.confirm("確定停用此攤位？顧客與工作人員將無法進入，但歷史資料會保留。");
      if (!confirmed) return;
      confirmation = "DEACTIVATE";
    }

    setIsSaving(true);
    try {
      const response = await fetch(
        isEditing
          ? `/api/merchant/stalls/${stallId}`
          : `/api/merchant/organizations/${organizationId}/stalls`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: csrfHeaders(),
          body: JSON.stringify(isEditing ? { ...draft, confirmation } : draft),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法儲存攤位。");

      if (!isEditing) {
        router.push(`/merchant/stalls/${payload.stall.id}?organizationId=${organizationId}`);
        router.refresh();
        return;
      }
      setMessage("攤位設定已更新。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法儲存攤位。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-7">
      <section>
        <h2 className="text-lg font-semibold">基本資料</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">攤位名稱<input value={draft.name} onChange={(event) => update("name", event.target.value)} required maxLength={80} className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5" /></label>
          <label className="text-sm font-medium">攤位代碼<input value={draft.code} onChange={(event) => update("code", event.target.value.toUpperCase())} required maxLength={30} pattern="[A-Za-z0-9-]+" className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5 uppercase" /></label>
          {!isEditing ? <label className="text-sm font-medium sm:col-span-2">網址代稱<input value={draft.slug ?? ""} onChange={(event) => update("slug", event.target.value.toLowerCase())} required minLength={3} maxLength={50} pattern="[a-z0-9-]+" className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5" /></label> : null}
          <label className="text-sm font-medium sm:col-span-2">說明<textarea value={draft.description} onChange={(event) => update("description", event.target.value)} maxLength={500} rows={3} className="mt-1.5 w-full resize-y rounded-md border border-stone-300 px-3 py-2.5" /></label>
          <label className="text-sm font-medium sm:col-span-2">地址<input value={draft.address} onChange={(event) => update("address", event.target.value)} required maxLength={200} className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5" /></label>
          <label className="text-sm font-medium">電話<input value={draft.phone} onChange={(event) => update("phone", event.target.value)} maxLength={30} autoComplete="tel" className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5" /></label>
          <label className="text-sm font-medium">時區<select value={draft.timezone} onChange={(event) => update("timezone", event.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3"><option value="Asia/Taipei">Asia/Taipei</option><option value="Asia/Tokyo">Asia/Tokyo</option><option value="Asia/Hong_Kong">Asia/Hong_Kong</option></select></label>
          <label className="text-sm font-medium">幣別<select value={draft.currency} onChange={(event) => update("currency", event.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3"><option value="TWD">TWD</option><option value="JPY">JPY</option><option value="HKD">HKD</option></select></label>
        </div>
      </section>

      {isEditing ? (
        <section className="border-t border-stone-200 pt-6">
          <h2 className="text-lg font-semibold">營運狀態</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">營業狀態<select value={draft.businessStatus} onChange={(event) => update("businessStatus", event.target.value as StallDraft["businessStatus"])} className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3"><option value="OPEN">營業中</option><option value="PAUSED">暫停</option><option value="CLOSED">關閉</option><option value="SOLD_OUT">全攤售罄</option></select></label>
            <div className="space-y-3 pt-1 sm:pt-6">
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.orderingEnabled} onChange={(event) => update("orderingEnabled", event.target.checked)} className="h-5 w-5" />允許顧客點餐</label>
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-red-800"><input type="checkbox" checked={draft.isActive} onChange={(event) => update("isActive", event.target.checked)} className="h-5 w-5" />啟用此攤位</label>
            </div>
          </div>
        </section>
      ) : null}

      {message ? <p role="status" className={message.includes("已更新") ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{message}</p> : null}
      <button type="submit" disabled={isSaving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {isEditing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {isSaving ? "儲存中..." : isEditing ? "儲存設定" : "建立攤位"}
      </button>
    </form>
  );
}
