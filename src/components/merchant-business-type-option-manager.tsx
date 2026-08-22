"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Archive, Plus, Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { MerchantBusinessTypeOptionDto } from "@/lib/merchant-business-type-options";
import { merchantBusinessTypeLabels, merchantBusinessTypes } from "@/lib/merchant-application-options";
import { formatAppNumber } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

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
  const { locale, m, label } = useMerchantMessages();
  const [options, setOptions] = useState(initialOptions);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, locale)),
    [locale, options],
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
    setHasError(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setHasError(false);
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
      setHasError(true);
      setMessage(locale === "zh-TW" && typeof result.error === "string" ? result.error : m("營業類型儲存失敗。"));
      return;
    }
    setOptions((current) => upsertOption(current, result.option));
    setForm(emptyForm);
    setMessage(m("營業類型已儲存。"));
  }

  async function archive(option: Option) {
    if (!window.confirm(m("停用「{name}」？既有申請紀錄仍會保留。", { name: option.name }))) return;
    setMessage("");
    setHasError(false);
    const response = await fetch(`/api/admin/merchant-business-types/${option.id}`, {
      method: "DELETE",
      headers: csrfHeaders(),
    });
    const result = await response.json();
    if (!response.ok) {
      setHasError(true);
      setMessage(locale === "zh-TW" && typeof result.error === "string" ? result.error : m("營業類型停用失敗。"));
      return;
    }
    setOptions((current) => upsertOption(current, result.option));
    setMessage(m("營業類型已停用。"));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section data-testid="merchant-business-types-mobile-list" className="grid gap-3 md:hidden">
        {sortedOptions.map((option) => (
          <article key={option.id ?? option.code} className="min-w-0 rounded-md border border-stone-200 bg-white p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h3 className="min-w-0 break-words text-lg font-semibold">{option.name}</h3>
              <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{option.archivedAt ? m("已停用") : option.isActive ? m("啟用") : m("關閉")}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <OptionDetail label={m("代碼")} value={option.code} mono />
              <OptionDetail label={m("排序")} value={formatAppNumber(locale, option.sortOrder)} />
              <div className="col-span-2 min-w-0"><dt className="text-xs font-semibold text-stone-500">{m("申請欄位")}</dt><dd className="mt-1 break-words">{label(merchantBusinessTypeLabels[option.legacyType] ?? option.legacyType)}</dd></div>
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => edit(option)} className="min-h-11 rounded-md border border-teal-700 px-3 text-sm font-semibold text-teal-800">{m("修改")}</button>
              {option.id ? <button type="button" onClick={() => void archive(option)} className="min-h-11 rounded-md border border-amber-500 px-3 text-sm font-semibold text-amber-800">{m("停用")}</button> : null}
            </div>
          </article>
        ))}
      </section>

      <section data-testid="merchant-business-types-desktop-table" className="hidden overflow-x-auto border-y border-stone-200 md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr>
              <th className="px-3 py-3">{m("名稱")}</th>
              <th className="px-3 py-3">{m("代碼")}</th>
              <th className="px-3 py-3">{m("申請欄位")}</th>
              <th className="px-3 py-3 text-right">{m("排序")}</th>
              <th className="px-3 py-3">{m("狀態")}</th>
              <th className="px-3 py-3 text-right">{m("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {sortedOptions.map((option) => (
              <tr key={option.id ?? option.code}>
                <td className="px-3 py-4 font-semibold">{option.name}</td>
                <td className="px-3 py-4 font-mono text-xs">{option.code}</td>
                <td className="px-3 py-4">{label(merchantBusinessTypeLabels[option.legacyType] ?? option.legacyType)}</td>
                <td className="px-3 py-4 text-right">{formatAppNumber(locale, option.sortOrder)}</td>
                <td className="px-3 py-4">{option.archivedAt ? m("已停用") : option.isActive ? m("啟用") : m("關閉")}</td>
                <td className="px-3 py-4 text-right">
                  <button type="button" onClick={() => edit(option)} className="inline-flex min-h-11 items-center font-semibold text-teal-800">{m("修改")}</button>
                  {option.id ? <button type="button" onClick={() => void archive(option)} className="ml-4 inline-flex min-h-11 items-center font-semibold text-amber-800">{m("停用")}</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form onSubmit={submit} className="border-y border-stone-200 bg-white py-5 lg:border lg:p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-teal-700" />
          <h2 className="text-lg font-semibold">{m("新增或修改類型")}</h2>
        </div>
        <div className="mt-4 grid gap-4">
          <Field label={m("代碼")}>
            <input type="text" required value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} maxLength={40} pattern="[A-Z][A-Z0-9_]{1,39}" className={inputClass} />
          </Field>
          <Field label={m("對應申請欄位")}>
            <select value={form.legacyType} onChange={(event) => setForm((current) => ({ ...current, legacyType: event.target.value as FormState["legacyType"] }))} className={inputClass}>
              {merchantBusinessTypes.map((type) => <option key={type} value={type}>{label(merchantBusinessTypeLabels[type])}</option>)}
            </select>
          </Field>
          <Field label={m("顯示名稱")}>
            <input type="text" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} className={inputClass} />
          </Field>
          <Field label={m("說明")}>
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={300} rows={3} className={inputClass} />
          </Field>
          <Field label={m("排序")}>
            <input type="number" min={0} max={10000} value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} className={inputClass} />
          </Field>
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} className="h-5 w-5 accent-teal-700" />
            {m("啟用於商家申請表")}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white"><Save className="h-4 w-4" />{m("儲存")}</button>
            <button type="button" onClick={() => setForm(emptyForm)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold"><Archive className="h-4 w-4" />{m("清空")}</button>
          </div>
          {message ? <p role="status" className={`text-sm font-medium ${hasError ? "text-red-700" : "text-teal-800"}`}>{message}</p> : null}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-stone-800"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function OptionDetail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className={`mt-1 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>;
}

function upsertOption(options: Option[], option: Option) {
  const index = options.findIndex((candidate) => candidate.id === option.id || candidate.code === option.code);
  if (index === -1) return [...options, option];
  return options.map((candidate, currentIndex) => currentIndex === index ? option : candidate);
}

const inputClass = "min-h-11 w-full border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100";
