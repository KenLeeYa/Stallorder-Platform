"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, MailCheck, Pencil, Play, Plus, Save, Trash2, X } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppDateTime } from "@/lib/locale-format";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
  type FieldErrors,
} from "@/lib/form-field-errors";
import {
  createReportScheduleTranslator,
  type ReportScheduleMessageKey,
  type ReportScheduleTranslator,
} from "@/lib/messages/report-schedules";
import type { ScheduledReportType } from "@/lib/report-schedule-contract";

type Delivery = {
  id: string;
  status: "PROCESSING" | "SENT" | "SIMULATED" | "FAILURE";
  subject: string;
  periodStart: string;
  periodEnd: string;
  recipientCount: number;
  errorCode: string | null;
  sentAt: string | null;
  createdAt: string;
};
type Schedule = {
  id: string;
  name: string;
  reportType: ScheduledReportType;
  recipients: string[];
  stallIds: string[];
  timezone: string;
  sendHour: number;
  sendMinute: number;
  dayOfWeek: number | null;
  isEnabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdByName: string;
  deliveries: Delivery[];
};
type Draft = Omit<Schedule, "id" | "nextRunAt" | "lastRunAt" | "createdByName" | "deliveries" | "recipients" | "sendHour" | "sendMinute"> & {
  recipientsText: string;
  sendTime: string;
};

export function ReportScheduleManager({
  organizationId,
  organizationEmail,
  stalls,
  initialSchedules,
  deliveryMode,
  returnStallId,
}: {
  organizationId: string;
  organizationEmail: string;
  stalls: Array<{ id: string; name: string }>;
  initialSchedules: Schedule[];
  deliveryMode: "CONFIGURED" | "SIMULATED" | "MISSING";
  returnStallId?: string;
}) {
  const router = useRouter();
  const { locale } = useAppLocale();
  const t = createReportScheduleTranslator(locale);
  const managerRef = useRef<HTMLElement>(null);
  const [archivedScheduleIds, setArchivedScheduleIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const schedules = initialSchedules.filter((schedule) => !archivedScheduleIds.includes(schedule.id));

  function newDraft(): Draft {
    return {
      name: t("schedule.defaultName"),
      reportType: "DAILY_SALES",
      recipientsText: organizationEmail,
      stallIds: stalls.map((stall) => stall.id),
      timezone: "Asia/Taipei",
      sendTime: "08:00",
      dayOfWeek: null,
      isEnabled: true,
    };
  }

  function edit(schedule: Schedule) {
    setEditingId(schedule.id);
    setDraft({
      name: schedule.name,
      reportType: schedule.reportType,
      recipientsText: schedule.recipients.join("\n"),
      stallIds: schedule.stallIds,
      timezone: schedule.timezone,
      sendTime: `${String(schedule.sendHour).padStart(2, "0")}:${String(schedule.sendMinute).padStart(2, "0")}`,
      dayOfWeek: schedule.dayOfWeek,
      isEnabled: schedule.isEnabled,
    });
    setMessage("");
    setHasError(false);
    setFieldErrors({});
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  async function save() {
    if (!draft) return;
    const recipients = [...new Set(draft.recipientsText.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
    const [sendHour, sendMinute] = draft.sendTime
      ? draft.sendTime.split(":").map(Number)
      : [null, null];
    const payload = {
      name: draft.name,
      reportType: draft.reportType,
      recipients,
      stallIds: draft.stallIds,
      timezone: draft.timezone,
      sendHour,
      sendMinute,
      dayOfWeek: draft.reportType === "WEEKLY_SALES" ? draft.dayOfWeek : null,
      isEnabled: draft.isEnabled,
    };
    setBusyId(editingId ?? "new");
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const url = editingId
        ? `/api/merchant/organizations/${organizationId}/report-schedules/${editingId}`
        : `/api/merchant/organizations/${organizationId}/report-schedules`;
      const response = await fetch(url, { method: editingId ? "PATCH" : "POST", headers: csrfHeaders(), body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const nextFieldErrors = localizeFieldErrors(parseFieldErrors(result.fieldErrors), t);
        setFieldErrors(nextFieldErrors);
        focusFirstInvalidField(managerRef.current, nextFieldErrors);
        setHasError(true);
        setMessage(locale === "zh-TW" && typeof result.error === "string" ? result.error : t("schedule.saveFailed"));
        return;
      }
      setMessage(editingId ? t("schedule.saved") : t("schedule.created"));
      setDraft(null);
      setEditingId(null);
      router.refresh();
    } catch (error) {
      setHasError(true);
      setMessage(locale === "zh-TW" && error instanceof Error ? error.message : t("schedule.saveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function runCommand(schedule: Schedule, operation: "TEST" | "ARCHIVE") {
    if (operation === "TEST" && !window.confirm(t("schedule.confirmTest", { name: schedule.name }))) return;
    if (operation === "ARCHIVE" && !window.confirm(t("schedule.confirmArchive", { name: schedule.name }))) return;
    setBusyId(schedule.id);
    setMessage("");
    setHasError(false);
    try {
      const response = await fetch(
        operation === "TEST"
          ? `/api/merchant/organizations/${organizationId}/report-schedules/${schedule.id}/test`
          : `/api/merchant/organizations/${organizationId}/report-schedules/${schedule.id}`,
        { method: operation === "TEST" ? "POST" : "DELETE", headers: csrfHeaders() },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(
        locale === "zh-TW" && typeof result.error === "string"
          ? result.error
          : t(operation === "TEST" ? "schedule.testFailed" : "schedule.archiveFailed"),
      );
      if (operation === "ARCHIVE") setArchivedScheduleIds((current) => [...current, schedule.id]);
      setMessage(operation === "TEST" ? (result.status === "SIMULATED" ? t("schedule.simulated") : t("schedule.testSent")) : t("schedule.archived"));
      router.refresh();
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : t("schedule.operationFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const editing = Boolean(draft);
  return (
    <main ref={managerRef} className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      {returnStallId ? (
        <div className="mb-4">
          <StallSettingsBackLink stallId={returnStallId} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5">
        <div><div className="flex items-center gap-2 text-teal-800"><CalendarClock className="h-5 w-5" /><span className="text-sm font-semibold">{t("schedule.eyebrow")}</span></div><h1 className="mt-2 text-3xl font-semibold">{t("schedule.title")}</h1><p className="mt-2 text-sm text-stone-600">{t("schedule.description")}</p></div>
        {!editing ? <button type="button" onClick={() => { setDraft(newDraft()); setEditingId(null); setFieldErrors({}); }} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("schedule.new")}</button> : null}
      </div>
      <div className={`border-b py-3 text-sm font-medium ${deliveryMode === "CONFIGURED" ? "border-emerald-200 text-emerald-800" : deliveryMode === "SIMULATED" ? "border-amber-200 text-amber-900" : "border-red-200 text-red-800"}`}>
        {t(deliveryMode === "CONFIGURED" ? "schedule.delivery.configured" : deliveryMode === "SIMULATED" ? "schedule.delivery.simulated" : "schedule.delivery.missing")}
      </div>
      {message ? <p role={hasError ? "alert" : "status"} className={`border-b border-stone-200 py-3 text-sm font-medium ${hasError ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}

      {draft ? <ScheduleEditor t={t} draft={draft} stalls={stalls} busy={busyId !== null} fieldErrors={fieldErrors} onChange={setDraft} onClearField={clearFieldError} onSave={() => void save()} onCancel={() => { setDraft(null); setEditingId(null); setFieldErrors({}); }} /> : null}

      <section className="py-6" aria-labelledby="schedules-title">
        <h2 id="schedules-title" className="text-lg font-semibold">{t("schedule.existing")}</h2>
        <div className="mt-4 grid gap-4">
          {schedules.map((schedule) => (
            <article key={schedule.id} className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{schedule.name}</h3><span className={`text-xs font-semibold ${schedule.isEnabled ? "text-emerald-700" : "text-stone-500"}`}>{t(schedule.isEnabled ? "schedule.enabled" : "schedule.disabled")}</span></div><p className="mt-1 text-sm text-stone-600">{t(reportTypeKey(schedule.reportType))} · {timeLabel(schedule, t)} · {t("schedule.recipientCount", { count: schedule.recipients.length })}</p><p className="mt-1 text-xs text-stone-500">{t("schedule.nextRun", { date: formatAppDateTime(locale, schedule.nextRunAt, { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }) })} · {t("schedule.creator", { name: schedule.createdByName })}</p></div><div className="flex gap-1"><button type="button" title={t("schedule.edit")} disabled={busyId !== null} onClick={() => edit(schedule)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-50"><Pencil className="h-4 w-4" /></button><button type="button" title={t("schedule.test")} disabled={busyId !== null} onClick={() => void runCommand(schedule, "TEST")} className="grid h-10 w-10 place-items-center rounded-md border border-teal-300 text-teal-800 disabled:opacity-50"><Play className="h-4 w-4" /></button><button type="button" title={t("schedule.archive")} disabled={busyId !== null} onClick={() => void runCommand(schedule, "ARCHIVE")} className="grid h-10 w-10 place-items-center rounded-md border border-red-200 text-red-700 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></div></div>
              <details className="mt-4 border-t border-stone-100 pt-3"><summary className="cursor-pointer list-none text-sm font-semibold text-teal-800 [&::-webkit-details-marker]:hidden">{t("schedule.recentDeliveries", { count: schedule.deliveries.length })}</summary><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{schedule.deliveries.map((delivery) => <div key={delivery.id} className="grid gap-1 py-3 text-xs sm:grid-cols-[120px_1fr_180px]"><span className={delivery.status === "FAILURE" ? "font-semibold text-red-700" : delivery.status === "SENT" ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>{t(deliveryStatusKey(delivery.status))}</span><span className="truncate">{t("schedule.deliveryPeriod", { start: delivery.periodStart, end: delivery.periodEnd, count: t("schedule.recipientCount", { count: delivery.recipientCount }) })}</span><span className="text-stone-500">{formatAppDateTime(locale, delivery.sentAt ?? delivery.createdAt, { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" })}{delivery.errorCode ? ` · ${delivery.errorCode}` : ""}</span></div>)}{schedule.deliveries.length === 0 ? <p className="py-4 text-xs text-stone-500">{t("schedule.noDeliveries")}</p> : null}</div></details>
            </article>
          ))}
          {schedules.length === 0 ? <div className="border-y border-stone-200 py-10 text-center"><MailCheck className="mx-auto h-8 w-8 text-stone-400" /><p className="mt-3 text-sm text-stone-500">{t("schedule.none")}</p></div> : null}
        </div>
      </section>
    </main>
  );
}

function ScheduleEditor({
  t,
  draft,
  stalls,
  busy,
  fieldErrors,
  onChange,
  onClearField,
  onSave,
  onCancel,
}: {
  t: ReportScheduleTranslator;
  draft: Draft;
  stalls: Array<{ id: string; name: string }>;
  busy: boolean;
  fieldErrors: FieldErrors;
  onChange: (draft: Draft) => void;
  onClearField: (field: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const selectedStalls = useMemo(() => new Set(draft.stallIds), [draft.stallIds]);
  const sendTimeError = fieldErrors.sendHour ?? fieldErrors.sendMinute;
  const sendTimeField = fieldErrors.sendMinute && !fieldErrors.sendHour ? "sendMinute" : "sendHour";
  return (
    <section className="border-b border-stone-200 py-6" aria-labelledby="editor-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="editor-title" className="text-lg font-semibold">{t("schedule.editorTitle")}</h2>
        <button type="button" title={t("schedule.close")} onClick={onCancel} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium">{t("schedule.name")}
          <input type="text" required value={draft.name} maxLength={80} data-field-key="name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? fieldErrorId("name") : undefined} onChange={(event) => { onClearField("name"); onChange({ ...draft, name: event.target.value }); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
          <FieldError field="name" error={fieldErrors.name} />
        </label>
        <label className="text-sm font-medium">{t("schedule.reportType")}
          <select value={draft.reportType} data-field-key="reportType" aria-invalid={Boolean(fieldErrors.reportType)} aria-describedby={fieldErrors.reportType ? fieldErrorId("reportType") : undefined} onChange={(event) => { const reportType = event.target.value as ScheduledReportType; onClearField("reportType"); onClearField("dayOfWeek"); onChange({ ...draft, reportType, dayOfWeek: reportType === "WEEKLY_SALES" ? draft.dayOfWeek ?? 1 : null }); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
            {(["DAILY_SALES", "WEEKLY_SALES", "PAYMENT_VARIANCE"] as const).map((value) => <option key={value} value={value}>{t(reportTypeKey(value))}</option>)}
          </select>
          <FieldError field="reportType" error={fieldErrors.reportType} />
        </label>
        <label className="text-sm font-medium">{t("schedule.sendTime")}
          <input type="time" required value={draft.sendTime} data-field-key={sendTimeField} aria-invalid={Boolean(sendTimeError)} aria-describedby={sendTimeError ? "report-schedule-send-time-error" : undefined} onChange={(event) => { onClearField("sendHour"); onClearField("sendMinute"); onChange({ ...draft, sendTime: event.target.value }); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
          {sendTimeError ? <span id="report-schedule-send-time-error" className="mt-1 block text-xs text-red-700">{sendTimeError}</span> : null}
        </label>
        {draft.reportType === "WEEKLY_SALES" ? (
          <label className="text-sm font-medium">{t("schedule.weekday")}
            <select value={draft.dayOfWeek ?? ""} required data-field-key="dayOfWeek" aria-invalid={Boolean(fieldErrors.dayOfWeek)} aria-describedby={fieldErrors.dayOfWeek ? fieldErrorId("dayOfWeek") : undefined} onChange={(event) => { onClearField("dayOfWeek"); onChange({ ...draft, dayOfWeek: event.target.value === "" ? null : Number(event.target.value) }); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
              <option value="">{t("schedule.select")}</option>
              {([0, 1, 2, 3, 4, 5, 6] as const).map((index) => <option key={index} value={index}>{t(weekdayKey(index))}</option>)}
            </select>
            <FieldError field="dayOfWeek" error={fieldErrors.dayOfWeek} />
          </label>
        ) : null}
        <label className="text-sm font-medium md:col-span-2">{t("schedule.recipients")}
          <textarea required value={draft.recipientsText} data-field-key="recipients" aria-invalid={Boolean(fieldErrors.recipients)} aria-describedby={fieldErrors.recipients ? fieldErrorId("recipients") : undefined} onChange={(event) => { onClearField("recipients"); onChange({ ...draft, recipientsText: event.target.value }); }} rows={3} maxLength={5_000} placeholder={t("schedule.recipientsPlaceholder")} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
          <FieldError field="recipients" error={fieldErrors.recipients} />
        </label>
        <fieldset tabIndex={-1} data-field-key="stallIds" aria-invalid={Boolean(fieldErrors.stallIds)} aria-describedby={fieldErrors.stallIds ? fieldErrorId("stallIds") : undefined} className="md:col-span-2">
          <legend className="text-sm font-medium">{t("schedule.stalls")}</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {stalls.map((stall) => (
              <label key={stall.id} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedStalls.has(stall.id)} aria-invalid={Boolean(fieldErrors.stallIds)} aria-describedby={fieldErrors.stallIds ? fieldErrorId("stallIds") : undefined} onChange={(event) => { onClearField("stallIds"); onChange({ ...draft, stallIds: event.target.checked ? [...draft.stallIds, stall.id] : draft.stallIds.filter((id) => id !== stall.id) }); }} />
                {stall.name}
              </label>
            ))}
          </div>
          <FieldError field="stallIds" error={fieldErrors.stallIds} />
        </fieldset>
        <label className="flex min-h-11 flex-wrap items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={draft.isEnabled} data-field-key="isEnabled" aria-invalid={Boolean(fieldErrors.isEnabled)} aria-describedby={fieldErrors.isEnabled ? fieldErrorId("isEnabled") : undefined} onChange={(event) => { onClearField("isEnabled"); onChange({ ...draft, isEnabled: event.target.checked }); }} />{t("schedule.enable")}
          <FieldError field="isEnabled" error={fieldErrors.isEnabled} />
        </label>
      </div>
      <div className="mt-5 flex gap-2">
        <button type="button" disabled={busy} onClick={onSave} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{t("schedule.save")}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{t("schedule.cancel")}</button>
      </div>
    </section>
  );
}

function FieldError({ field, error }: { field: string; error?: string }) {
  return error ? <span id={fieldErrorId(field)} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null;
}

function fieldErrorId(field: string) {
  return `report-schedule-${field}-error`;
}

function timeLabel(schedule: Schedule, t: ReportScheduleTranslator) {
  const time = `${String(schedule.sendHour).padStart(2, "0")}:${String(schedule.sendMinute).padStart(2, "0")}`;
  return schedule.reportType === "WEEKLY_SALES"
    ? t("schedule.weeklyAt", { weekday: t(weekdayKey(schedule.dayOfWeek ?? 1)), time })
    : t("schedule.everyDay", { time });
}

function reportTypeKey(reportType: ScheduledReportType): ReportScheduleMessageKey {
  return {
    DAILY_SALES: "schedule.type.daily",
    WEEKLY_SALES: "schedule.type.weekly",
    PAYMENT_VARIANCE: "schedule.type.variance",
  }[reportType] as ReportScheduleMessageKey;
}

function weekdayKey(day: number): ReportScheduleMessageKey {
  const safeDay = Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1;
  return `schedule.weekday.${safeDay}` as ReportScheduleMessageKey;
}

function deliveryStatusKey(status: Delivery["status"]): ReportScheduleMessageKey {
  return {
    PROCESSING: "schedule.delivery.processing",
    SENT: "schedule.delivery.sent",
    SIMULATED: "schedule.delivery.simulatedStatus",
    FAILURE: "schedule.delivery.failure",
  }[status] as ReportScheduleMessageKey;
}

function localizeFieldErrors(errors: FieldErrors, t: ReportScheduleTranslator): FieldErrors {
  return Object.fromEntries(Object.keys(errors).map((field) => [field, t("schedule.validationField")]));
}
