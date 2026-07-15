"use client";

import { useState } from "react";
import { Copy, Plus, Printer, QrCode, RotateCw, Save, Trash2, WalletCards } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { csrfHeaders } from "@/lib/csrf-client";

type ModuleState = {
  settings: {
    dineInEnabled: boolean;
    printModuleEnabled: boolean;
    paymentModuleEnabled: boolean;
    discountModuleEnabled: boolean;
  };
  tables: Array<{
    id: string;
    code: string;
    label: string;
    isActive: boolean;
    sortOrder: number;
    qrCode: { token: string; tokenVersion: number } | null;
  }>;
  paymentOptions: Array<{
    id: string;
    code: string;
    name: string;
    kind: "CASH" | "LINE_PAY" | "JKO_PAY" | "CUSTOM";
    isEnabled: boolean;
    sortOrder: number;
  }>;
  discounts: Array<{
    id: string;
    name: string;
    rateBps: number;
    isEnabled: boolean;
    sortOrder: number;
  }>;
};

type TableDraft = Omit<ModuleState["tables"][number], "id" | "qrCode">;
type PaymentDraft = Omit<ModuleState["paymentOptions"][number], "id">;
type DiscountDraft = Omit<ModuleState["discounts"][number], "id">;

export function StallModulesManager({
  stallId,
  appUrl,
  initialState,
}: {
  stallId: string;
  appUrl: string;
  initialState: ModuleState;
}) {
  const [state, setState] = useState(initialState);
  const [newTable, setNewTable] = useState<TableDraft>({ code: "", label: "", isActive: true, sortOrder: initialState.tables.length + 1 });
  const [newPayment, setNewPayment] = useState<PaymentDraft>({ code: "", name: "", kind: "CUSTOM", isEnabled: true, sortOrder: initialState.paymentOptions.length + 1 });
  const [newDiscount, setNewDiscount] = useState<DiscountDraft>({ name: "", rateBps: 9000, isEnabled: true, sortOrder: initialState.discounts.length + 1 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(command: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/modules`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新模組設定。");
      setState(payload.state);
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新模組設定。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function updateTable(id: string, changes: Partial<ModuleState["tables"][number]>) {
    setState((current) => ({ ...current, tables: current.tables.map((table) => table.id === id ? { ...table, ...changes } : table) }));
  }

  function updatePayment(id: string, changes: Partial<ModuleState["paymentOptions"][number]>) {
    setState((current) => ({ ...current, paymentOptions: current.paymentOptions.map((option) => option.id === id ? { ...option, ...changes } : option) }));
  }

  function updateDiscount(id: string, changes: Partial<ModuleState["discounts"][number]>) {
    setState((current) => ({ ...current, discounts: current.discounts.map((discount) => discount.id === id ? { ...discount, ...changes } : discount) }));
  }

  async function saveModules() {
    await run({ operation: "UPDATE_MODULES", ...state.settings }, "模組開關已儲存。");
  }

  return (
    <section className="mt-8 border-t border-stone-200 pt-7" aria-labelledby="stall-modules-heading">
      <div className="flex items-start gap-3">
        <WalletCards className="mt-1 h-5 w-5 text-teal-700" />
        <div>
          <h2 id="stall-modules-heading" className="text-xl font-semibold">營運模組與內用桌位</h2>
          <p className="mt-1 text-sm text-stone-600">模組關閉後保留既有資料與歷史對帳，不會刪除紀錄。</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <ModuleSwitch label="內用桌位" checked={state.settings.dineInEnabled} onChange={(dineInEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, dineInEnabled } }))} />
        <ModuleSwitch label="訂單列印" icon={<Printer className="h-4 w-4" />} checked={state.settings.printModuleEnabled} onChange={(printModuleEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, printModuleEnabled } }))} />
        <ModuleSwitch label="多元付款" checked={state.settings.paymentModuleEnabled} onChange={(paymentModuleEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, paymentModuleEnabled } }))} />
        <ModuleSwitch label="結帳折扣" checked={state.settings.discountModuleEnabled} onChange={(discountModuleEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, discountModuleEnabled } }))} />
      </div>
      <button type="button" disabled={busy} onClick={() => void saveModules()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存模組開關</button>

      <details className="mt-8 border-y border-stone-200" open>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden"><QrCode className="h-4 w-4 text-teal-700" />內用桌位與專屬 QR</summary>
        <div className="pb-6">
          <div className="grid gap-2 border-b border-stone-200 pb-4 sm:grid-cols-[120px_1fr_90px_auto]">
            <TextInput label="桌位代碼" value={newTable.code} onChange={(code) => setNewTable({ ...newTable, code: code.toUpperCase() })} />
            <TextInput label="顯示名稱" value={newTable.label} onChange={(label) => setNewTable({ ...newTable, label })} />
            <NumberInput label="排序" value={newTable.sortOrder} onChange={(sortOrder) => setNewTable({ ...newTable, sortOrder })} />
            <button type="button" disabled={busy || !newTable.code || !newTable.label} onClick={async () => {
              if (await run({ operation: "CREATE_TABLE", ...newTable }, "桌位與專屬 QR 已建立。")) setNewTable({ code: "", label: "", isActive: true, sortOrder: state.tables.length + 2 });
            }} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />新增</button>
          </div>
          <div className="divide-y divide-stone-200">
            {state.tables.map((table) => {
              const qrUrl = table.qrCode ? `${appUrl.replace(/\/$/, "")}/q/${encodeURIComponent(table.qrCode.token)}` : "";
              return <div key={table.id} className="grid gap-4 py-5 lg:grid-cols-[1fr_160px]">
                <div className="grid gap-3 sm:grid-cols-[120px_1fr_90px]">
                  <TextInput label="桌位代碼" value={table.code} onChange={(code) => updateTable(table.id, { code: code.toUpperCase() })} />
                  <TextInput label="顯示名稱" value={table.label} onChange={(label) => updateTable(table.id, { label })} />
                  <NumberInput label="排序" value={table.sortOrder} onChange={(sortOrder) => updateTable(table.id, { sortOrder })} />
                  <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={table.isActive} onChange={(event) => updateTable(table.id, { isActive: event.target.checked })} />啟用桌位</label>
                  <div className="flex flex-wrap gap-2 sm:col-span-3">
                    <button type="button" disabled={busy} onClick={() => void run({ operation: "UPDATE_TABLE", tableId: table.id, code: table.code, label: table.label, sortOrder: table.sortOrder, isActive: table.isActive }, `${table.label} 已儲存。`)} className="inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"><Save className="h-4 w-4" />儲存</button>
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm(`確定輪替 ${table.label} 的 QR？舊 QR 將立即失效。`)) void run({ operation: "ROTATE_TABLE_QR", tableId: table.id }, "桌位 QR 已輪替。"); }} className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><RotateCw className="h-4 w-4" />輪替 QR</button>
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm(`確定刪除 ${table.label}？`)) void run({ operation: "DELETE_TABLE", tableId: table.id }, "桌位已刪除。"); }} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-300 text-red-700" title={`刪除 ${table.label}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                {qrUrl ? <div className="flex flex-col items-center gap-2 border-l-0 border-stone-200 lg:border-l lg:pl-4"><QRCodeSVG value={qrUrl} size={120} level="M" /><button type="button" onClick={() => void navigator.clipboard.writeText(qrUrl)} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800"><Copy className="h-3.5 w-3.5" />複製網址</button><span className="text-xs text-stone-500">QR v{table.qrCode?.tokenVersion}</span></div> : null}
              </div>;
            })}
            {state.tables.length === 0 ? <p className="py-6 text-sm text-stone-500">尚未建立內用桌位。</p> : null}
          </div>
        </div>
      </details>

      <details className="border-b border-stone-200" open={state.settings.paymentModuleEnabled}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">付款方式</summary>
        <div className="pb-6">
          <div className="grid gap-2 border-b border-stone-200 pb-4 sm:grid-cols-[110px_1fr_150px_80px_auto]">
            <TextInput label="代碼" value={newPayment.code} onChange={(code) => setNewPayment({ ...newPayment, code: code.toUpperCase() })} />
            <TextInput label="名稱" value={newPayment.name} onChange={(name) => setNewPayment({ ...newPayment, name })} />
            <PaymentKind value={newPayment.kind} onChange={(kind) => setNewPayment({ ...newPayment, kind })} />
            <NumberInput label="排序" value={newPayment.sortOrder} onChange={(sortOrder) => setNewPayment({ ...newPayment, sortOrder })} />
            <button type="button" disabled={busy || !newPayment.code || !newPayment.name} onClick={async () => {
              if (await run({ operation: "CREATE_PAYMENT_OPTION", ...newPayment }, "付款方式已新增。")) setNewPayment({ code: "", name: "", kind: "CUSTOM", isEnabled: true, sortOrder: state.paymentOptions.length + 2 });
            }} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />新增</button>
          </div>
          <div className="divide-y divide-stone-200">{state.paymentOptions.map((option) => <div key={option.id} className="grid gap-2 py-4 sm:grid-cols-[110px_1fr_150px_80px_auto] sm:items-end"><TextInput label="代碼" value={option.code} onChange={(code) => updatePayment(option.id, { code: code.toUpperCase() })} /><TextInput label="名稱" value={option.name} onChange={(name) => updatePayment(option.id, { name })} /><PaymentKind value={option.kind} onChange={(kind) => updatePayment(option.id, { kind })} /><NumberInput label="排序" value={option.sortOrder} onChange={(sortOrder) => updatePayment(option.id, { sortOrder })} /><div className="flex gap-2"><button type="button" role="switch" aria-checked={option.isEnabled} onClick={() => updatePayment(option.id, { isEnabled: !option.isEnabled })} className="h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold">{option.isEnabled ? "已啟用" : "已停用"}</button><button type="button" title={`儲存 ${option.name}`} onClick={() => void run({ operation: "UPDATE_PAYMENT_OPTION", paymentOptionId: option.id, code: option.code, name: option.name, kind: option.kind, isEnabled: option.isEnabled, sortOrder: option.sortOrder }, "付款方式已儲存。")} className="grid h-10 w-10 place-items-center rounded-md bg-stone-900 text-white"><Save className="h-4 w-4" /></button><button type="button" title={`刪除 ${option.name}`} onClick={() => { if (window.confirm(`確定刪除 ${option.name}？歷史付款仍會保留名稱。`)) void run({ operation: "DELETE_PAYMENT_OPTION", paymentOptionId: option.id }, "付款方式已刪除。"); }} className="grid h-10 w-10 place-items-center rounded-md border border-red-300 text-red-700"><Trash2 className="h-4 w-4" /></button></div></div>)}</div>
        </div>
      </details>

      <details className="border-b border-stone-200" open={state.settings.discountModuleEnabled}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">結帳折扣</summary>
        <div className="pb-6">
          <div className="grid gap-2 border-b border-stone-200 pb-4 sm:grid-cols-[1fr_130px_80px_auto]"><TextInput label="折扣名稱" value={newDiscount.name} onChange={(name) => setNewDiscount({ ...newDiscount, name })} /><PercentInput value={newDiscount.rateBps} onChange={(rateBps) => setNewDiscount({ ...newDiscount, rateBps })} /><NumberInput label="排序" value={newDiscount.sortOrder} onChange={(sortOrder) => setNewDiscount({ ...newDiscount, sortOrder })} /><button type="button" disabled={busy || !newDiscount.name} onClick={async () => { if (await run({ operation: "CREATE_DISCOUNT", ...newDiscount }, "折扣已新增。")) setNewDiscount({ name: "", rateBps: 9000, isEnabled: true, sortOrder: state.discounts.length + 2 }); }} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Plus className="h-4 w-4" />新增</button></div>
          <div className="divide-y divide-stone-200">{state.discounts.map((discount) => <div key={discount.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_130px_80px_auto] sm:items-end"><TextInput label="折扣名稱" value={discount.name} onChange={(name) => updateDiscount(discount.id, { name })} /><PercentInput value={discount.rateBps} onChange={(rateBps) => updateDiscount(discount.id, { rateBps })} /><NumberInput label="排序" value={discount.sortOrder} onChange={(sortOrder) => updateDiscount(discount.id, { sortOrder })} /><div className="flex gap-2"><button type="button" role="switch" aria-checked={discount.isEnabled} onClick={() => updateDiscount(discount.id, { isEnabled: !discount.isEnabled })} className="h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold">{discount.isEnabled ? "已啟用" : "已停用"}</button><button type="button" title={`儲存 ${discount.name}`} onClick={() => void run({ operation: "UPDATE_DISCOUNT", discountId: discount.id, name: discount.name, rateBps: discount.rateBps, isEnabled: discount.isEnabled, sortOrder: discount.sortOrder }, "折扣已儲存。")} className="grid h-10 w-10 place-items-center rounded-md bg-stone-900 text-white"><Save className="h-4 w-4" /></button><button type="button" title={`刪除 ${discount.name}`} onClick={() => { if (window.confirm(`確定刪除 ${discount.name}？`)) void run({ operation: "DELETE_DISCOUNT", discountId: discount.id }, "折扣已刪除。"); }} className="grid h-10 w-10 place-items-center rounded-md border border-red-300 text-red-700"><Trash2 className="h-4 w-4" /></button></div></div>)}</div>
        </div>
      </details>
      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
    </section>
  );
}

function ModuleSwitch({ label, icon, checked, onChange }: { label: string; icon?: React.ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`flex min-h-12 items-center gap-3 rounded-md border px-3 text-left text-sm font-semibold ${checked ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-600"}`}>{icon}<span>{label}</span><span className="ml-auto text-xs">{checked ? "開啟" : "關閉"}</span></button>;
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-medium text-stone-600">{label}<input value={value} onChange={(event) => onChange(event.target.value)} maxLength={50} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm" /></label>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-xs font-medium text-stone-600">{label}<input type="number" min={0} max={10000} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm" /></label>;
}

function PercentInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <label className="text-xs font-medium text-stone-600">付款比例（%）<input type="number" min={1} max={100} step={1} value={value / 100} onChange={(event) => onChange(Math.round(Number(event.target.value) * 100))} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm" /></label>;
}

function PaymentKind({ value, onChange }: { value: PaymentDraft["kind"]; onChange: (value: PaymentDraft["kind"]) => void }) {
  return <label className="text-xs font-medium text-stone-600">類型<select value={value} onChange={(event) => onChange(event.target.value as PaymentDraft["kind"])} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-2 text-sm"><option value="CASH">現金</option><option value="LINE_PAY">LINE Pay</option><option value="JKO_PAY">街口支付</option><option value="CUSTOM">自訂</option></select></label>;
}
