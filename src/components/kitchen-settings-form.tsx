"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import type { KitchenBoardMode } from "@/lib/kitchen-contract";

export function KitchenSettingsForm({ stallSlug, initialSettings }: { stallSlug: string; initialSettings: { warningMinutes: number; criticalMinutes: number; defaultView: KitchenBoardMode } }) {
  const { t } = useOperationsLocale();
  const [settings, setSettings] = useState<{
    warningMinutes: number | "";
    criticalMinutes: number | "";
    defaultView: KitchenBoardMode;
  }>(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);
  function clearError(field: string) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }
  async function save() {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/stalls/${stallSlug}/kitchen/settings`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify(settings) });
      const payload = await response.json() as { error?: string; fieldErrors?: Record<string, string> };
      if (!response.ok) {
        setHasError(true);
        setMessage(t("kitchen.settings.saveFailed"));
        const nextFieldErrors = payload.fieldErrors ?? {};
        setFieldErrors(nextFieldErrors);
        const firstField = Object.keys(nextFieldErrors)[0];
        if (firstField) requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field-key="${firstField}"]`)?.focus());
        return;
      }
      setMessage(t("kitchen.settings.saved"));
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : t("kitchen.settings.saveFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={formRef} className="mx-auto max-w-3xl"><div className="border-b border-stone-200 pb-5"><h2 className="text-2xl font-semibold">{t("kitchen.settings.title")}</h2><p className="mt-2 text-sm text-stone-600">{t("kitchen.settings.description")}</p></div>{message ? <p role={hasError ? "alert" : "status"} className={`mt-4 border-l-4 px-4 py-3 text-sm ${hasError ? "border-red-600 bg-red-50 text-red-800" : "border-teal-700 bg-teal-50 text-teal-900"}`}>{message}</p> : null}<section className="py-6"><div className="grid gap-4 sm:grid-cols-2"><KitchenNumberField label={t("kitchen.settings.warningMinutes")} fieldKey="warningMinutes" error={fieldErrors.warningMinutes} min={1} max={120} value={settings.warningMinutes} onChange={(value) => { clearError("warningMinutes"); setSettings({ ...settings, warningMinutes: value === "" ? "" : Number(value) }); }} /><KitchenNumberField label={t("kitchen.settings.criticalMinutes")} fieldKey="criticalMinutes" error={fieldErrors.criticalMinutes} min={2} max={240} value={settings.criticalMinutes} onChange={(value) => { clearError("criticalMinutes"); setSettings({ ...settings, criticalMinutes: value === "" ? "" : Number(value) }); }} /><label className="text-sm font-medium sm:col-span-2">{t("kitchen.settings.defaultView")}<select value={settings.defaultView} data-field-key="defaultView" aria-invalid={Boolean(fieldErrors.defaultView)} aria-describedby={fieldErrors.defaultView ? "kds-default-view-error" : undefined} onChange={(event) => { clearError("defaultView"); setSettings({ ...settings, defaultView: event.target.value as KitchenBoardMode }); }} className="form-input mt-1 bg-white"><option value="ORDER">{t("kitchen.mode.order")}</option><option value="ITEM">{t("kitchen.mode.item")}</option><option value="STATION">{t("kitchen.mode.station")}</option></select>{fieldErrors.defaultView ? <span id="kds-default-view-error" className="mt-1 block text-xs text-red-700">{fieldErrors.defaultView}</span> : null}</label></div><button type="button" disabled={busy} onClick={() => void save()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("kitchen.settings.save")}</button></section></div>
  );
}

function KitchenNumberField({ label, fieldKey, error, min, max, value, onChange }: { label: string; fieldKey: string; error?: string; min: number; max: number; value: number | ""; onChange: (value: string) => void }) {
  const errorId = `kds-${fieldKey}-error`;
  return <label className="text-sm font-medium">{label}<input aria-label={label} type="number" min={min} max={max} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => onChange(event.target.value)} className="form-input mt-1" />{error ? <span id={errorId} className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
