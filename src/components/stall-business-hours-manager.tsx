"use client";

import { useRef, useState } from "react";
import { Clock3, Save } from "lucide-react";
import { CollapsibleSectionSummary } from "@/components/collapsible-section-summary";
import { csrfHeaders } from "@/lib/csrf-client";
import { businessDayLabels } from "@/lib/business-hours";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

export type BusinessHourView = {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
};

export function StallBusinessHoursManager({ stallId, initialHours }: { stallId: string; initialHours: BusinessHourView[] }) {
  const normalized = businessDayLabels.map((_, dayOfWeek) => initialHours.find((hour) => hour.dayOfWeek === dayOfWeek) ?? { dayOfWeek, opensAt: "17:00", closesAt: "23:00", isClosed: false });
  const [hours, setHours] = useState(normalized);
  const [savedHours, setSavedHours] = useState(normalized);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDetailsElement>(null);
  const dirty = JSON.stringify(hours) !== JSON.stringify(savedHours);
  useUnsavedSettings("business-hours", dirty);

  function update(dayOfWeek: number, changes: Partial<BusinessHourView>) {
    setHours((current) => current.map((hour) => hour.dayOfWeek === dayOfWeek ? { ...hour, ...changes } : hour));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/business-hours`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ hours }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        setMessage(payload.error ?? "目前無法儲存營業時間。");
        setHasError(true);
        focusFirstInvalidField(containerRef.current, nextFieldErrors);
        return;
      }
      const next = businessDayLabels.map((_, dayOfWeek) => payload.hours.find((hour: BusinessHourView) => hour.dayOfWeek === dayOfWeek));
      setHours(next);
      setSavedHours(next);
      setMessage("營業時間已儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法儲存營業時間。");
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  return <details ref={containerRef} open data-settings-section data-settings-scope="business-hours" data-settings-search="營業時間 星期 開店 打烊 公休 多攤位範本" className="border-b border-stone-200 data-[dirty=true]:border-l-2 data-[dirty=true]:border-l-amber-500 [&[open]>summary_.section-chevron]:rotate-180">
    <CollapsibleSectionSummary icon={Clock3} title="營業時間" description={dirty ? "有尚未儲存的變更" : "可供多攤位範本複製。"} />
    <div className="pb-6">
      {message ? <p role={hasError ? "alert" : "status"} className={`mb-3 text-sm font-medium ${hasError ? "text-red-700" : "text-stone-700"}`}>{message}</p> : null}
      <div className="divide-y divide-stone-200 border-y border-stone-200">{hours.map((hour, index) => {
        const opensAtKey = `hours.${index}.opensAt`;
        const closesAtKey = `hours.${index}.closesAt`;
        return <div key={hour.dayOfWeek} className="grid gap-3 py-3 sm:grid-cols-[100px_100px_1fr] sm:items-center"><strong className="text-sm">{businessDayLabels[hour.dayOfWeek]}</strong><label className="flex items-center gap-2 text-xs font-semibold text-stone-600"><input type="checkbox" checked={hour.isClosed} onChange={(event) => update(hour.dayOfWeek, { isClosed: event.target.checked })} />公休</label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-stone-600">開始<input {...fieldValidationProps(opensAtKey, fieldErrors[opensAtKey])} type="time" disabled={hour.isClosed} value={hour.opensAt} onChange={(event) => update(hour.dayOfWeek, { opensAt: event.target.value })} className={timeInputClass(fieldErrors[opensAtKey])} />{fieldErrors[opensAtKey] ? <span id={fieldErrorId(opensAtKey)} role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors[opensAtKey]}</span> : null}</label><label className="text-xs font-semibold text-stone-600">結束<input {...fieldValidationProps(closesAtKey, fieldErrors[closesAtKey])} type="time" disabled={hour.isClosed} value={hour.closesAt} onChange={(event) => update(hour.dayOfWeek, { closesAt: event.target.value })} className={timeInputClass(fieldErrors[closesAtKey])} />{fieldErrors[closesAtKey] ? <span id={fieldErrorId(closesAtKey)} role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors[closesAtKey]}</span> : null}</label></div></div>;
      })}</div>
      <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存營業時間</button>
    </div>
  </details>;
}

function fieldErrorId(field: string) {
  return `business-hours-${field.replace(/\./g, "-")}-error`;
}

function fieldValidationProps(field: string, error?: string) {
  return {
    "data-field-key": field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? fieldErrorId(field) : undefined,
  };
}

function timeInputClass(error?: string) {
  return `mt-1 h-10 w-full rounded-md border px-2 text-sm disabled:bg-stone-100 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`;
}

function parseFieldErrors(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === "string" && Boolean(entry[1].trim())
  )));
}

function focusFirstInvalidField(container: HTMLElement | null, fieldErrors: Record<string, string>) {
  const field = Object.keys(fieldErrors)[0];
  if (!field || field === "hours") return;
  requestAnimationFrame(() => {
    container?.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(field)}"]`)?.focus();
  });
}
