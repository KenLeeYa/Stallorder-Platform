"use client";

import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { useRef, useState } from "react";
import {
  CalendarPlus,
  Check,
  Clock3,
  Copy,
  Link2,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";
import { normalizeAutomaticOrderingFlags } from "@/lib/stall-schedule-contract";

type LocationView = { id: string; name: string; address: string; isActive: boolean };
type EventView = { id: string; name: string; venueName: string; startsAt: string; endsAt: string };
type ScheduleStatus = "SCHEDULED" | "OPEN" | "DELAYED" | "CANCELLED" | "COMPLETED";
type ScheduleView = {
  id: string;
  locationId: string | null;
  marketEventId: string | null;
  startsAt: string;
  endsAt: string;
  orderingOpensAt: string | null;
  orderingClosesAt: string | null;
  status: ScheduleStatus;
  specialNotice: string | null;
  menuOverrideId: string | null;
  autoOpenEnabled: boolean;
  autoCloseEnabled: boolean;
  location: LocationView | null;
  marketEvent: EventView | null;
};
type QrView = {
  id: string;
  label: string;
  state: string;
  diningTableId: string | null;
  stallScheduleId: string | null;
  fulfillmentTypeContext: "TAKEOUT" | "DINE_IN" | "DELIVERY" | null;
};
type Data = {
  stall: { id: string; name: string; timezone: string; slug: string };
  capabilities: {
    scheduleLimit: number | null;
    recurringCopy: boolean;
    automaticOrdering: boolean;
    eventSchedule: boolean;
  };
  locations: LocationView[];
  events: EventView[];
  schedules: ScheduleView[];
  qrCodes: QrView[];
};

const emptyForm = {
  locationId: "",
  marketEventId: "",
  startsAt: "",
  endsAt: "",
  orderingOpensAt: "",
  orderingClosesAt: "",
  specialNotice: "",
  autoOpenEnabled: false,
  autoCloseEnabled: false,
};

type PendingAction = {
  scheduleId: string;
  operation: "SET_STATUS" | "DELETE";
  status?: "OPEN" | "DELAYED" | "CANCELLED" | "COMPLETED";
  label: string;
};

export function StallScheduleManager({ stallId, initialData }: { stallId: string; initialData: Data }) {
  const { locale, m, label } = useMerchantMessages();
  const formatRange = (start: string, end: string) => {
    const formatter = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    return `${formatter.format(new Date(start))}～${formatter.format(new Date(end))}`;
  };
  const formatShortDate = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [copyWeeks, setCopyWeeks] = useState("4");
  const [qrCodeId, setQrCodeId] = useState(initialData.qrCodes[0]?.id ?? "");
  const [qrScheduleId, setQrScheduleId] = useState("");
  const [qrFulfillmentType, setQrFulfillmentType] = useState<"TAKEOUT" | "DINE_IN" | "DELIVERY">("TAKEOUT");
  const managerRef = useRef<HTMLDivElement>(null);

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  function edit(schedule: ScheduleView) {
    const automaticOrdering = normalizeAutomaticOrderingFlags(
      data.capabilities.automaticOrdering,
      schedule,
    );
    setEditingId(schedule.id);
    setForm({
      locationId: schedule.locationId ?? "",
      marketEventId: schedule.marketEventId ?? "",
      startsAt: toDateTimeLocal(schedule.startsAt),
      endsAt: toDateTimeLocal(schedule.endsAt),
      orderingOpensAt: schedule.orderingOpensAt ? toDateTimeLocal(schedule.orderingOpensAt) : "",
      orderingClosesAt: schedule.orderingClosesAt ? toDateTimeLocal(schedule.orderingClosesAt) : "",
      specialNotice: schedule.specialNotice ?? "",
      ...automaticOrdering,
    });
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
  }

  async function mutate(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/schedule`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as { error?: string; fieldErrors?: unknown } & Data;
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        setMessage(payload.error ?? label("目前無法更新出攤行程。"));
        setHasError(true);
        focusFirstInvalidField(managerRef.current, nextFieldErrors);
        return;
      }
      setData(payload);
      setMessage(successMessage);
      setPendingAction(null);
      setReason("");
      setActionNotice("");
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("目前無法更新出攤行程。"));
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const automaticOrdering = normalizeAutomaticOrderingFlags(
      data.capabilities.automaticOrdering,
      form,
    );
    await mutate({
      operation: editingId ? "UPDATE" : "CREATE",
      ...(editingId ? { scheduleId: editingId } : {}),
      locationId: form.locationId || null,
      marketEventId: form.marketEventId || null,
      startsAt: toIsoOrOriginal(form.startsAt),
      endsAt: toIsoOrOriginal(form.endsAt),
      orderingOpensAt: form.orderingOpensAt ? toIsoOrOriginal(form.orderingOpensAt) : null,
      orderingClosesAt: form.orderingClosesAt ? toIsoOrOriginal(form.orderingClosesAt) : null,
      specialNotice: form.specialNotice.trim() || null,
      menuOverrideId: null,
      ...automaticOrdering,
    }, editingId ? label("行程已更新。") : label("行程已建立。"));
  }

  async function confirmOperationalAction() {
    if (!pendingAction) return;
    if (pendingAction.operation === "DELETE") {
      await mutate({ operation: "DELETE", scheduleId: pendingAction.scheduleId, reason }, label("行程已刪除。"));
      return;
    }
    await mutate({
      operation: "SET_STATUS",
      scheduleId: pendingAction.scheduleId,
      status: pendingAction.status,
      reason,
      specialNotice: actionNotice.trim() || null,
    }, m("{value0}完成。", { value0: pendingAction.label }));
  }

  async function copySchedule(scheduleId: string) {
    await mutate({ operation: "COPY_WEEKLY", scheduleId, weeks: Number(copyWeeks), reason }, m("已建立未來 {value0} 週行程。", { value0: copyWeeks }));
  }

  async function bindQr() {
    const qr = data.qrCodes.find((candidate) => candidate.id === qrCodeId);
    await mutate({
      operation: "ASSIGN_QR_CONTEXT",
      qrCodeId,
      scheduleId: qrScheduleId || null,
      fulfillmentType: qrScheduleId ? (qr?.diningTableId ? "DINE_IN" : qrFulfillmentType) : null,
      reason,
    }, qrScheduleId ? label("QR Code 已綁定行程。") : label("QR Code 行程綁定已解除。"));
  }

  const activeScheduleCount = data.schedules.filter((schedule) => ["SCHEDULED", "OPEN", "DELAYED"].includes(schedule.status)).length;
  const limitReached = data.capabilities.scheduleLimit !== null && activeScheduleCount >= data.capabilities.scheduleLimit;
  const qr = data.qrCodes.find((candidate) => candidate.id === qrCodeId);

  return (
    <div ref={managerRef} className="space-y-10">
      <section aria-labelledby="schedule-form-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4"><div><h2 id="schedule-form-title" className="flex items-center gap-2 text-xl font-semibold"><CalendarPlus className="h-5 w-5 text-teal-700" />{editingId ? label("修改出攤行程") : label("新增出攤行程")}</h2><p className="mt-1 text-sm text-stone-600">{label("時間依")} {data.stall.timezone} {label("管理；目前")} {activeScheduleCount}{data.capabilities.scheduleLimit ? ` / ${data.capabilities.scheduleLimit}` : ""} {label("個進行中行程。")}</p></div>{editingId ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><X className="h-4 w-4" />{label("取消編輯")}</button> : null}</div>
        {message ? <p role={hasError ? "alert" : "status"} className={`mt-4 text-sm font-semibold ${hasError ? "text-red-700" : "text-stone-700"}`}>{message}</p> : null}
        {data.locations.length === 0 ? <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-amber-800">{label("請先建立常用地點，或由 Pro 方案建立市集活動。")}</p> : null}
        <form noValidate onSubmit={(event) => void submit(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label={label("常用地點")} field="locationId" error={fieldErrors.locationId}><select {...validationProps("locationId", fieldErrors.locationId)} value={form.locationId} onChange={(event) => { clearFieldError("locationId"); setForm({ ...form, locationId: event.target.value }); }} className={inputClass(fieldErrors.locationId)}><option value="">{label("不指定")}</option>{data.locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          {data.capabilities.eventSchedule ? <Field label={label("市集活動")} field="marketEventId" error={fieldErrors.marketEventId}><select {...validationProps("marketEventId", fieldErrors.marketEventId)} value={form.marketEventId} onChange={(event) => { clearFieldError("marketEventId"); setForm({ ...form, marketEventId: event.target.value }); }} className={inputClass(fieldErrors.marketEventId)}><option value="">{label("不指定")}</option>{data.events.map((event) => <option key={event.id} value={event.id}>{event.name} · {event.venueName}</option>)}</select></Field> : <div className="text-sm text-stone-500 sm:self-end">{label("Pro 方案可建立跨攤位市集活動。")}</div>}
          <Field label={label("行程開始")} field="startsAt" error={fieldErrors.startsAt}><input {...validationProps("startsAt", fieldErrors.startsAt)} type="datetime-local" required value={form.startsAt} onChange={(event) => { clearFieldError("startsAt"); setForm({ ...form, startsAt: event.target.value }); }} className={inputClass(fieldErrors.startsAt)} /></Field>
          <Field label={label("行程結束")} field="endsAt" error={fieldErrors.endsAt}><input {...validationProps("endsAt", fieldErrors.endsAt)} type="datetime-local" required value={form.endsAt} onChange={(event) => { clearFieldError("endsAt"); setForm({ ...form, endsAt: event.target.value }); }} className={inputClass(fieldErrors.endsAt)} /></Field>
          <Field label={label("開放接單（留空同開始時間）")} field="orderingOpensAt" error={fieldErrors.orderingOpensAt}><input {...validationProps("orderingOpensAt", fieldErrors.orderingOpensAt)} type="datetime-local" value={form.orderingOpensAt} onChange={(event) => { clearFieldError("orderingOpensAt"); setForm({ ...form, orderingOpensAt: event.target.value }); }} className={inputClass(fieldErrors.orderingOpensAt)} /></Field>
          <Field label={label("停止接單（留空同結束時間）")} field="orderingClosesAt" error={fieldErrors.orderingClosesAt}><input {...validationProps("orderingClosesAt", fieldErrors.orderingClosesAt)} type="datetime-local" value={form.orderingClosesAt} onChange={(event) => { clearFieldError("orderingClosesAt"); setForm({ ...form, orderingClosesAt: event.target.value }); }} className={inputClass(fieldErrors.orderingClosesAt)} /></Field>
          <label className="block text-xs font-semibold text-stone-600 sm:col-span-2">{label("公開臨時公告（選填）")}<textarea {...validationProps("specialNotice", fieldErrors.specialNotice)} maxLength={500} value={form.specialNotice} onChange={(event) => { clearFieldError("specialNotice"); setForm({ ...form, specialNotice: event.target.value }); }} className={`mt-1 min-h-20 w-full rounded-md border p-3 text-sm ${fieldErrors.specialNotice ? "border-red-500 bg-red-50" : "border-stone-300"}`} />{fieldErrors.specialNotice ? <FieldError field="specialNotice" error={fieldErrors.specialNotice} /> : null}</label>
          <label className="flex min-h-11 flex-wrap items-center gap-3 text-sm font-semibold"><input {...validationProps("autoOpenEnabled", fieldErrors.autoOpenEnabled)} type="checkbox" disabled={!data.capabilities.automaticOrdering} checked={form.autoOpenEnabled} onChange={(event) => { clearFieldError("autoOpenEnabled"); setForm({ ...form, autoOpenEnabled: event.target.checked }); }} />{label("到時自動開放接單")}{fieldErrors.autoOpenEnabled ? <FieldError field="autoOpenEnabled" error={fieldErrors.autoOpenEnabled} /> : null}</label>
          <label className="flex min-h-11 flex-wrap items-center gap-3 text-sm font-semibold"><input {...validationProps("autoCloseEnabled", fieldErrors.autoCloseEnabled)} type="checkbox" disabled={!data.capabilities.automaticOrdering} checked={form.autoCloseEnabled} onChange={(event) => { clearFieldError("autoCloseEnabled"); setForm({ ...form, autoCloseEnabled: event.target.checked }); }} />{label("到時自動停止接單")}{fieldErrors.autoCloseEnabled ? <FieldError field="autoCloseEnabled" error={fieldErrors.autoCloseEnabled} /> : null}</label>
          <div className="sm:col-span-2 sm:text-right"><button type="submit" disabled={busy || (limitReached && !editingId)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{editingId ? <Save className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}{editingId ? label("儲存行程") : label("建立行程")}</button></div>
        </form>
      </section>

      <section aria-labelledby="schedule-actions-title">
        <h2 id="schedule-actions-title" className="text-xl font-semibold">{label("行程與現場狀態")}</h2>
        <div className="mt-4 grid gap-4 rounded-md border border-stone-200 bg-white p-4 sm:grid-cols-[1fr_120px]"><Field label={label("操作原因（狀態、複製、QR 綁定必填）")} field="reason" error={fieldErrors.reason}><input {...validationProps("reason", fieldErrors.reason)} type="text" value={reason} onChange={(event) => { clearFieldError("reason"); setReason(event.target.value); }} minLength={3} maxLength={300} className={inputClass(fieldErrors.reason)} /></Field><Field label={label("複製週數")} field="weeks" error={fieldErrors.weeks}><input {...validationProps("weeks", fieldErrors.weeks)} type="number" min={1} max={12} value={copyWeeks} onChange={(event) => { clearFieldError("weeks"); setCopyWeeks(event.target.value); }} className={inputClass(fieldErrors.weeks)} /></Field></div>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{data.schedules.map((schedule) => <article key={schedule.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{schedule.marketEvent?.name ?? schedule.location?.name ?? label("出攤行程")}</h3><Status status={schedule.status} /></div><p className="mt-2 flex items-center gap-2 text-sm text-stone-600"><Clock3 className="h-4 w-4" />{formatRange(schedule.startsAt, schedule.endsAt)}</p><p className="mt-1 text-sm text-stone-500">{schedule.location?.address ?? schedule.marketEvent?.venueName ?? label("地點待補")}</p>{schedule.specialNotice ? <p className="mt-2 text-sm text-amber-800">{schedule.specialNotice}</p> : null}</div><div className="flex gap-2">{["SCHEDULED", "DELAYED"].includes(schedule.status) ? <button type="button" title={label("修改行程")} onClick={() => edit(schedule)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button> : null}{data.capabilities.recurringCopy && !schedule.marketEventId ? <button type="button" title={label("複製週期行程")} disabled={busy} onClick={() => void copySchedule(schedule.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 disabled:opacity-40"><Copy className="h-4 w-4" /></button> : null}<button type="button" title={label("刪除行程")} disabled={!["SCHEDULED", "CANCELLED"].includes(schedule.status)} onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "DELETE", label: label("刪除行程") })} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-200 text-red-700 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div></div><div className="mt-4 flex flex-wrap gap-2">{schedule.status === "SCHEDULED" || schedule.status === "DELAYED" ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "OPEN", label: label("立即開攤") })} className={actionClass}>{label("立即開攤")}</button> : null}{schedule.status === "SCHEDULED" ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "DELAYED", label: label("延遲開攤") })} className={actionClass}>{label("延遲開攤")}</button> : null}{schedule.status === "OPEN" ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "COMPLETED", label: label("提前收攤") })} className={actionClass}>{label("提前收攤")}</button> : null}{["SCHEDULED", "OPEN", "DELAYED"].includes(schedule.status) ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "CANCELLED", label: label("臨時停業") })} className="min-h-10 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700">{label("臨時停業")}</button> : null}</div>{pendingAction?.scheduleId === schedule.id ? <div className="mt-4 grid gap-3 border-l-2 border-amber-500 pl-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><Field label={label("顧客公告（選填）")} field="actionNotice" error={fieldErrors.actionNotice}><input {...validationProps("actionNotice", fieldErrors.actionNotice)} type="text" value={actionNotice} onChange={(event) => { clearFieldError("actionNotice"); setActionNotice(event.target.value); }} maxLength={500} className={inputClass(fieldErrors.actionNotice)} /></Field><button type="button" disabled={busy} onClick={() => void confirmOperationalAction()} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{label("確認")}{pendingAction.label}</button><button type="button" onClick={() => { setPendingAction(null); setActionNotice(""); clearFieldError("actionNotice"); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">{label("取消")}</button></div> : null}</article>)}{data.schedules.length === 0 ? <p className="py-8 text-sm text-stone-500">{label("尚未建立出攤行程。")}</p> : null}</div>
      </section>

      <section aria-labelledby="qr-schedule-title">
        <h2 id="qr-schedule-title" className="flex items-center gap-2 text-xl font-semibold"><Link2 className="h-5 w-5 text-teal-700" />{label("QR 行程綁定")}</h2><p className="mt-1 text-sm text-stone-600">{label("綁定後，後端會在建立 session 與送單時驗證地點、活動及接單時間。")}</p>
        <div className="mt-4 grid gap-4 rounded-md border border-stone-200 bg-white p-4 sm:grid-cols-3"><Field label="QR Code" field="qrCodeId" error={fieldErrors.qrCodeId}><select {...validationProps("qrCodeId", fieldErrors.qrCodeId)} value={qrCodeId} onChange={(event) => { clearFieldError("qrCodeId"); setQrCodeId(event.target.value); }} className={inputClass(fieldErrors.qrCodeId)}>{data.qrCodes.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.state}</option>)}</select></Field><Field label={label("綁定行程")} field="scheduleId" error={fieldErrors.scheduleId}><select {...validationProps("scheduleId", fieldErrors.scheduleId)} value={qrScheduleId} onChange={(event) => { clearFieldError("scheduleId"); setQrScheduleId(event.target.value); }} className={inputClass(fieldErrors.scheduleId)}><option value="">{label("解除行程綁定")}</option>{data.schedules.filter((schedule) => ["SCHEDULED", "OPEN", "DELAYED"].includes(schedule.status)).map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.marketEvent?.name ?? schedule.location?.name ?? label("行程")} · {formatShortDate(schedule.startsAt)}</option>)}</select></Field><Field label={label("點餐類型")} field="fulfillmentType" error={fieldErrors.fulfillmentType}><select {...validationProps("fulfillmentType", fieldErrors.fulfillmentType)} disabled={Boolean(qr?.diningTableId) || !qrScheduleId} value={qr?.diningTableId ? "DINE_IN" : qrFulfillmentType} onChange={(event) => { clearFieldError("fulfillmentType"); setQrFulfillmentType(event.target.value as typeof qrFulfillmentType); }} className={inputClass(fieldErrors.fulfillmentType)}><option value="TAKEOUT">{label("外帶")}</option><option value="DINE_IN">{label("內用")}</option><option value="DELIVERY">{label("外送")}</option></select></Field><div className="sm:col-span-3 sm:text-right"><button type="button" disabled={busy} onClick={() => void bindQr()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Link2 className="h-4 w-4" />{label("套用 QR 綁定")}</button></div></div>
      </section>
    </div>
  );
}

function Field({ label, field, error, children }: { label: string; field: string; error?: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-stone-600">{label}{children}{error ? <FieldError field={field} error={error} /> : null}</label>; }
function FieldError({ field, error }: { field: string; error: string }) { return <span id={fieldErrorId(field)} role="alert" className="mt-1 block w-full text-xs text-red-700">{error}</span>; }
function validationProps(field: string, error?: string) { return { "data-field-key": field, "aria-invalid": error ? true : undefined, "aria-describedby": error ? fieldErrorId(field) : undefined }; }
function fieldErrorId(field: string) { return `stall-schedule-${field}-error`; }
function Status({ status }: { status: ScheduleStatus }) { const { label } = useMerchantMessages(); const labels = { SCHEDULED: "預定", OPEN: "營業中", DELAYED: "延遲", CANCELLED: "已取消", COMPLETED: "已結束" }; return <span className={`text-xs font-semibold ${status === "OPEN" ? "text-teal-700" : status === "DELAYED" ? "text-amber-700" : "text-stone-500"}`}>{label(labels[status])}</span>; }
function toDateTimeLocal(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function toIsoOrOriginal(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString(); }
function inputClass(error?: string) { return `mt-1 h-11 w-full rounded-md border bg-white px-3 text-sm text-stone-950 disabled:bg-stone-100 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`; }
const actionClass = "min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold text-teal-800";
