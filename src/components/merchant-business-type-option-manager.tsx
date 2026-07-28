"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Archive, Plus, Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { MerchantBusinessTypeOptionDto } from "@/lib/merchant-business-type-options";
import { merchantBusinessTypeLabels, merchantBusinessTypes } from "@/lib/merchant-application-options";

type Option = MerchantBusinessTypeOptionDto & {
  archivedAt?: string | Date | null;
};

type FormState = {
  code: string;
  legacyType: (typeof merchantBusinessTypes)[number];
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  code: "",
  legacyType: "NIGHT_MARKET_STALL",
  name: "",
  description: "",
  sortOrder: "100",
  isActive: true,
};

export function MerchantBusinessTypeOptionManager({ initialOptions }: { initialOptions: Option[] }) {
  const [options, setOptions] = useState(initialOptions);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [message, setMessage] = useState("");
  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-Hant-TW")),
    [options],
  );

  function edit(option: Option) {
    setForm({
      code: option.code,
      legacyType: option.legacyType,
      name: option.name,
      description: option.description ?? "",
      sortOrder: String(option.sortOrder),
      isActive: option.isActive,
    });
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/admin/merchant-business-types", {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({
        code: form.code.trim().toUpperCase(),
        legacyType: form.legacyType,
        name: form.name.trim(),
        description: form.description.trim() || null,
        sortOrder: Number(form.sortOrder),
        isActive: form.isActive,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "營業類型儲存失敗。");
      return;
    }
    setOptions((current) => upsertOption(current, result.option));
    setForm(emptyForm);
    setMessage("營業類型已儲存。");
  }

  async function archive(option: Option) {
    if (!window.confirm(`停用「${option.name}」？既有申請紀錄仍會保留。`)) return;
    setMessage("");
    const response = await fetch(`/api/admin/merchant-business-types/${option.id}`, {
      method: "DELETE",
      headers: csrfHeaders(),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "營業類型停用失敗。");
      return;
    }
    setOptions((current) => upsertOption(current, result.option));
    setMessage("營業類型已停用。");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-x-auto border-y border-stone-200">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr>
              <th className="px-3 py-3">名稱</th>
              <th className="px-3 py-3">代碼</th>
              <th className="px-3 py-3">申請欄位</th>
              <th className="px-3 py-3 text-right">排序</th>
              <th className="px-3 py-3">狀態</th>
              <th className="px-3 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {sortedOptions.map((option) => (
              <tr key={option.id ?? option.code}>
                <td className="px-3 py-4 font-semibold">{option.name}</td>
                <td className="px-3 py-4 font-mono text-xs">{option.code}</td>
                <td className="px-3 py-4">{merchantBusinessTypeLabels[option.legacyType] ?? option.legacyType}</td>
                <td className="px-3 py-4 text-right">{option.sortOrder}</td>
                <td className="px-3 py-4">{option.archivedAt ? "已停用" : option.isActive ? "啟用" : "關閉"}</td>
                <td className="px-3 py-4 text-right">
                  <button type="button" onClick={() => edit(option)} className="font-semibold text-teal-800">修改</button>
                  {option.id ? <button type="button" onClick={() => void archive(option)} className="ml-4 font-semibold text-amber-800">停用</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form onSubmit={submit} className="border-y border-stone-200 bg-white py-5 lg:border lg:p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-teal-700" />
          <h2 className="text-lg font-semibold">新增或修改類型</h2>
        </div>
        <div className="mt-4 grid gap-4">
          <Field label="代碼">
            <input type="text" required value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} maxLength={40} pattern="[A-Z][A-Z0-9_]{1,39}" className={inputClass} />
          </Field>
          <Field label="對應申請欄位">
            <select value={form.legacyType} onChange={(event) => setForm((current) => ({ ...current, legacyType: event.target.value as FormState["legacyType"] }))} className={inputClass}>
              {merchantBusinessTypes.map((type) => <option key={type} value={type}>{merchantBusinessTypeLabels[type]}</option>)}
            </select>
          </Field>
          <Field label="顯示名稱">
            <input type="text" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} className={inputClass} />
          </Field>
          <Field label="說明">
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={300} rows={3} className={inputClass} />
          </Field>
          <Field label="排序">
            <input type="number" min={0} max={10000} value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} className={inputClass} />
          </Field>
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} className="h-5 w-5 accent-teal-700" />
            啟用於商家申請表
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white"><Save className="h-4 w-4" />儲存</button>
            <button type="button" onClick={() => setForm(emptyForm)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold"><Archive className="h-4 w-4" />清空</button>
          </div>
          {message ? <p role="status" className={`text-sm font-medium ${/失敗/.test(message) ? "text-red-700" : "text-teal-800"}`}>{message}</p> : null}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-stone-800"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function upsertOption(options: Option[], option: Option) {
  const index = options.findIndex((candidate) => candidate.id === option.id || candidate.code === option.code);
  if (index === -1) return [...options, option];
  return options.map((candidate, currentIndex) => currentIndex === index ? option : candidate);
}

const inputClass = "min-h-11 w-full border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100";
