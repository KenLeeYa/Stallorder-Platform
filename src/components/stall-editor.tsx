"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Plus, Save, Store } from "lucide-react";
import { CollapsibleSectionSummary } from "@/components/collapsible-section-summary";
import { csrfHeaders } from "@/lib/csrf-client";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

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

type SaveSection = "basic" | "operations";
const basicFieldKeys = ["name", "code", "description", "address", "phone", "timezone", "currency"] as const;
const operationFieldKeys = ["businessStatus", "orderingEnabled", "isActive"] as const;

export function StallEditor({
  organizationId,
  stallId,
  initial,
  section = "all",
}: {
  organizationId: string;
  stallId?: string;
  initial: StallDraft;
  section?: "all" | SaveSection;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [savedDraft, setSavedDraft] = useState(initial);
  const [messages, setMessages] = useState<Record<SaveSection, string>>({ basic: "", operations: "" });
  const [savingSection, setSavingSection] = useState<SaveSection | null>(null);
  const isEditing = Boolean(stallId);
  const basicDirty = basicFieldKeys.some((key) => draft[key] !== savedDraft[key]);
  const operationsDirty = isEditing && operationFieldKeys.some((key) => draft[key] !== savedDraft[key]);
  useUnsavedSettings("stall-basic", basicDirty);
  useUnsavedSettings("stall-operations", operationsDirty);

  function update<K extends keyof StallDraft>(key: K, value: StallDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setMessage(section: SaveSection, message: string) {
    setMessages((current) => ({ ...current, [section]: message }));
  }

  async function persist(payload: Record<string, unknown>, section: SaveSection) {
    setMessage(section, "");
    setSavingSection(section);
    try {
      const response = await fetch(
        isEditing
          ? `/api/merchant/stalls/${stallId}`
          : `/api/merchant/organizations/${organizationId}/stalls`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: csrfHeaders(),
          body: JSON.stringify(payload),
        },
      );
      const responsePayload = await response.json();
      if (!response.ok) throw new Error(responsePayload.error ?? "目前無法儲存攤位。");

      if (!isEditing) {
        router.push(`/merchant/stalls/${responsePayload.stall.id}?organizationId=${organizationId}`);
        router.refresh();
        return true;
      }
      setMessage(section, section === "basic" ? "基本資料已更新。" : "營運狀態已更新。");
      router.refresh();
      return true;
    } catch (error) {
      setMessage(section, error instanceof Error ? error.message : "目前無法儲存攤位。");
      return false;
    } finally {
      setSavingSection(null);
    }
  }

  async function submitBasic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const basicFields = {
      name: draft.name,
      code: draft.code,
      description: draft.description,
      address: draft.address,
      phone: draft.phone,
      timezone: draft.timezone,
      currency: draft.currency,
    };
    const saved = await persist(
      isEditing
        ? { operation: "UPDATE_BASIC", ...basicFields }
        : { ...basicFields, slug: draft.slug },
      "basic",
    );
    if (saved) setSavedDraft((current) => ({ ...current, ...basicFields }));
  }

  async function submitOperations(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isEditing) return;

    let confirmation: "DEACTIVATE" | undefined;
    if (draft.isActive === false) {
      const confirmed = window.confirm("確定停用此攤位？顧客與工作人員將無法進入，但歷史資料會保留。");
      if (!confirmed) return;
      confirmation = "DEACTIVATE";
    }

    const saved = await persist({
      operation: "UPDATE_OPERATIONS",
      businessStatus: draft.businessStatus,
      orderingEnabled: draft.orderingEnabled,
      isActive: draft.isActive,
      confirmation,
    }, "operations");
    if (saved) setSavedDraft((current) => ({
      ...current,
      businessStatus: draft.businessStatus,
      orderingEnabled: draft.orderingEnabled,
      isActive: draft.isActive,
    }));
  }

  return (
    <div className="border-t border-stone-200">
      {section !== "operations" ? <details open data-settings-section data-settings-scope="stall-basic" data-settings-search="基本資料 名稱 代碼 說明 地址 電話 時區 幣別" className="border-b border-stone-200 data-[dirty=true]:border-l-2 data-[dirty=true]:border-l-amber-500 [&[open]>summary_.section-chevron]:rotate-180">
        <CollapsibleSectionSummary icon={Store} title="基本資料" description={basicDirty ? "有尚未儲存的變更" : undefined} />
        <form onSubmit={submitBasic} className="pb-7">
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
          {messages.basic ? <p role="status" className={messages.basic.includes("已更新") ? "mt-4 text-sm text-emerald-700" : "mt-4 text-sm text-red-700"}>{messages.basic}</p> : null}
          <button type="submit" disabled={savingSection !== null} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {isEditing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {savingSection === "basic" ? "儲存中..." : isEditing ? "儲存基本資料" : "建立攤位"}
          </button>
        </form>
      </details> : null}

      {isEditing && section !== "basic" ? (
        <details open data-settings-section data-settings-scope="stall-operations" data-settings-search="營運狀態 營業 顧客點餐 啟用 攤位" className="border-b border-stone-200 data-[dirty=true]:border-l-2 data-[dirty=true]:border-l-amber-500 [&[open]>summary_.section-chevron]:rotate-180">
          <CollapsibleSectionSummary icon={Activity} title="營運狀態" description={operationsDirty ? "有尚未儲存的變更" : undefined} />
          <form onSubmit={submitOperations} className="pb-7">
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">營業狀態<select value={draft.businessStatus} onChange={(event) => update("businessStatus", event.target.value as StallDraft["businessStatus"])} className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3"><option value="OPEN">營業中</option><option value="PAUSED">暫停</option><option value="CLOSED">關閉</option><option value="SOLD_OUT">全攤售罄</option></select></label>
              <div className="space-y-3 pt-1 sm:pt-6">
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.orderingEnabled} onChange={(event) => update("orderingEnabled", event.target.checked)} className="h-5 w-5" />允許顧客點餐</label>
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-red-800"><input type="checkbox" checked={draft.isActive} onChange={(event) => update("isActive", event.target.checked)} className="h-5 w-5" />啟用此攤位</label>
              </div>
            </div>
            {messages.operations ? <p role="status" className={messages.operations.includes("已更新") ? "mt-4 text-sm text-emerald-700" : "mt-4 text-sm text-red-700"}>{messages.operations}</p> : null}
            <button type="submit" disabled={savingSection !== null} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Save className="h-4 w-4" />
              {savingSection === "operations" ? "儲存中..." : "儲存營運狀態"}
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
