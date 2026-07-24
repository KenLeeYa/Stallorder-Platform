"use client";

import { useState } from "react";
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
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [copyWeeks, setCopyWeeks] = useState(4);
  const [qrCodeId, setQrCodeId] = useState(initialData.qrCodes[0]?.id ?? "");
  const [qrScheduleId, setQrScheduleId] = useState("");
  const [qrFulfillmentType, setQrFulfillmentType] = useState<"TAKEOUT" | "DINE_IN" | "DELIVERY">("TAKEOUT");

  function edit(schedule: ScheduleView) {
    setEditingId(schedule.id);
    setForm({
      locationId: schedule.locationId ?? "",
      marketEventId: schedule.marketEventId ?? "",
      startsAt: toDateTimeLocal(schedule.startsAt),
      endsAt: toDateTimeLocal(schedule.endsAt),
      orderingOpensAt: schedule.orderingOpensAt ? toDateTimeLocal(schedule.orderingOpensAt) : "",
      orderingClosesAt: schedule.orderingClosesAt ? toDateTimeLocal(schedule.orderingClosesAt) : "",
      specialNotice: schedule.specialNotice ?? "",
      autoOpenEnabled: schedule.autoOpenEnabled,
      autoCloseEnabled: schedule.autoCloseEnabled,
    });
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function mutate(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/schedule`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新出攤行程。");
      setData(payload);
      setMessage(successMessage);
      setPendingAction(null);
      setReason("");
      setActionNotice("");
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新出攤行程。");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await mutate({
      operation: editingId ? "UPDATE" : "CREATE",
      ...(editingId ? { scheduleId: editingId } : {}),
      locationId: form.locationId || null,
      marketEventId: form.marketEventId || null,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      orderingOpensAt: form.orderingOpensAt ? new Date(form.orderingOpensAt).toISOString() : null,
      orderingClosesAt: form.orderingClosesAt ? new Date(form.orderingClosesAt).toISOString() : null,
      specialNotice: form.specialNotice.trim() || null,
      menuOverrideId: null,
      autoOpenEnabled: form.autoOpenEnabled,
      autoCloseEnabled: form.autoCloseEnabled,
    }, editingId ? "行程已更新。" : "行程已建立。");
  }

  async function confirmOperationalAction() {
    if (!pendingAction) return;
    if (pendingAction.operation === "DELETE") {
      await mutate({ operation: "DELETE", scheduleId: pendingAction.scheduleId, reason }, "行程已刪除。");
      return;
    }
    await mutate({
      operation: "SET_STATUS",
      scheduleId: pendingAction.scheduleId,
      status: pendingAction.status,
      reason,
      specialNotice: actionNotice.trim() || null,
    }, `${pendingAction.label}完成。`);
  }

  async function copySchedule(scheduleId: string) {
    await mutate({ operation: "COPY_WEEKLY", scheduleId, weeks: copyWeeks, reason }, `已建立未來 ${copyWeeks} 週行程。`);
  }

  async function bindQr() {
    const qr = data.qrCodes.find((candidate) => candidate.id === qrCodeId);
    await mutate({
      operation: "ASSIGN_QR_CONTEXT",
      qrCodeId,
      scheduleId: qrScheduleId || null,
      fulfillmentType: qrScheduleId ? (qr?.diningTableId ? "DINE_IN" : qrFulfillmentType) : null,
      reason,
    }, qrScheduleId ? "QR Code 已綁定行程。" : "QR Code 行程綁定已解除。");
  }

  const activeScheduleCount = data.schedules.filter((schedule) => ["SCHEDULED", "OPEN", "DELAYED"].includes(schedule.status)).length;
  const limitReached = data.capabilities.scheduleLimit !== null && activeScheduleCount >= data.capabilities.scheduleLimit;
  const qr = data.qrCodes.find((candidate) => candidate.id === qrCodeId);

  return (
    <div className="space-y-10">
      <section aria-labelledby="schedule-form-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4"><div><h2 id="schedule-form-title" className="flex items-center gap-2 text-xl font-semibold"><CalendarPlus className="h-5 w-5 text-teal-700" />{editingId ? "修改出攤行程" : "新增出攤行程"}</h2><p className="mt-1 text-sm text-stone-600">時間依 {data.stall.timezone} 管理；目前 {activeScheduleCount}{data.capabilities.scheduleLimit ? ` / ${data.capabilities.scheduleLimit}` : ""} 個進行中行程。</p></div>{editingId ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><X className="h-4 w-4" />取消編輯</button> : null}</div>
        {message ? <p role="status" className="mt-4 text-sm font-semibold text-stone-700">{message}</p> : null}
        {data.locations.length === 0 ? <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-amber-800">請先建立常用地點，或由 Pro 方案建立市集活動。</p> : null}
        <form onSubmit={(event) => void submit(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="常用地點"><select value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })} className={inputClass}><option value="">不指定</option>{data.locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          {data.capabilities.eventSchedule ? <Field label="市集活動"><select value={form.marketEventId} onChange={(event) => setForm({ ...form, marketEventId: event.target.value })} className={inputClass}><option value="">不指定</option>{data.events.map((event) => <option key={event.id} value={event.id}>{event.name} · {event.venueName}</option>)}</select></Field> : <div className="text-sm text-stone-500 sm:self-end">Pro 方案可建立跨攤位市集活動。</div>}
          <Field label="行程開始"><input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className={inputClass} /></Field>
          <Field label="行程結束"><input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className={inputClass} /></Field>
          <Field label="開放接單（留空同開始時間）"><input type="datetime-local" value={form.orderingOpensAt} onChange={(event) => setForm({ ...form, orderingOpensAt: event.target.value })} className={inputClass} /></Field>
          <Field label="停止接單（留空同結束時間）"><input type="datetime-local" value={form.orderingClosesAt} onChange={(event) => setForm({ ...form, orderingClosesAt: event.target.value })} className={inputClass} /></Field>
          <label className="block text-xs font-semibold text-stone-600 sm:col-span-2">公開臨時公告（選填）<textarea maxLength={500} value={form.specialNotice} onChange={(event) => setForm({ ...form, specialNotice: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 p-3 text-sm" /></label>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" disabled={!data.capabilities.automaticOrdering} checked={form.autoOpenEnabled} onChange={(event) => setForm({ ...form, autoOpenEnabled: event.target.checked })} />到時自動開放接單</label>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" disabled={!data.capabilities.automaticOrdering} checked={form.autoCloseEnabled} onChange={(event) => setForm({ ...form, autoCloseEnabled: event.target.checked })} />到時自動停止接單</label>
          <div className="sm:col-span-2 sm:text-right"><button type="submit" disabled={busy || (!form.locationId && !form.marketEventId) || (limitReached && !editingId)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{editingId ? <Save className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}{editingId ? "儲存行程" : "建立行程"}</button></div>
        </form>
      </section>

      <section aria-labelledby="schedule-actions-title">
        <h2 id="schedule-actions-title" className="text-xl font-semibold">行程與現場狀態</h2>
        <div className="mt-4 grid gap-4 rounded-md border border-stone-200 bg-white p-4 sm:grid-cols-[1fr_120px]"><Field label="操作原因（狀態、複製、QR 綁定必填）"><input type="text" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={300} className={inputClass} /></Field><Field label="複製週數"><input type="number" min={1} max={12} value={copyWeeks} onChange={(event) => setCopyWeeks(Number(event.target.value))} className={inputClass} /></Field></div>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{data.schedules.map((schedule) => <article key={schedule.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{schedule.marketEvent?.name ?? schedule.location?.name ?? "出攤行程"}</h3><Status status={schedule.status} /></div><p className="mt-2 flex items-center gap-2 text-sm text-stone-600"><Clock3 className="h-4 w-4" />{formatRange(schedule.startsAt, schedule.endsAt)}</p><p className="mt-1 text-sm text-stone-500">{schedule.location?.address ?? schedule.marketEvent?.venueName ?? "地點待補"}</p>{schedule.specialNotice ? <p className="mt-2 text-sm text-amber-800">{schedule.specialNotice}</p> : null}</div><div className="flex gap-2">{["SCHEDULED", "DELAYED"].includes(schedule.status) ? <button type="button" title="修改行程" onClick={() => edit(schedule)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button> : null}{data.capabilities.recurringCopy && !schedule.marketEventId ? <button type="button" title="複製週期行程" disabled={busy || reason.trim().length < 3} onClick={() => void copySchedule(schedule.id)} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 disabled:opacity-40"><Copy className="h-4 w-4" /></button> : null}<button type="button" title="刪除行程" disabled={!["SCHEDULED", "CANCELLED"].includes(schedule.status)} onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "DELETE", label: "刪除行程" })} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-200 text-red-700 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div></div><div className="mt-4 flex flex-wrap gap-2">{schedule.status === "SCHEDULED" || schedule.status === "DELAYED" ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "OPEN", label: "立即開攤" })} className={actionClass}>立即開攤</button> : null}{schedule.status === "SCHEDULED" ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "DELAYED", label: "延遲開攤" })} className={actionClass}>延遲開攤</button> : null}{schedule.status === "OPEN" ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "COMPLETED", label: "提前收攤" })} className={actionClass}>提前收攤</button> : null}{["SCHEDULED", "OPEN", "DELAYED"].includes(schedule.status) ? <button type="button" onClick={() => setPendingAction({ scheduleId: schedule.id, operation: "SET_STATUS", status: "CANCELLED", label: "臨時停業" })} className="min-h-10 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700">臨時停業</button> : null}</div>{pendingAction?.scheduleId === schedule.id ? <div className="mt-4 grid gap-3 border-l-2 border-amber-500 pl-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"><Field label="顧客公告（選填）"><input type="text" value={actionNotice} onChange={(event) => setActionNotice(event.target.value)} maxLength={500} className={inputClass} /></Field><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void confirmOperationalAction()} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />確認{pendingAction.label}</button><button type="button" onClick={() => { setPendingAction(null); setActionNotice(""); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">取消</button></div> : null}</article>)}{data.schedules.length === 0 ? <p className="py-8 text-sm text-stone-500">尚未建立出攤行程。</p> : null}</div>
      </section>

      <section aria-labelledby="qr-schedule-title">
        <h2 id="qr-schedule-title" className="flex items-center gap-2 text-xl font-semibold"><Link2 className="h-5 w-5 text-teal-700" />QR 行程綁定</h2><p className="mt-1 text-sm text-stone-600">綁定後，後端會在建立 session 與送單時驗證地點、活動及接單時間。</p>
        <div className="mt-4 grid gap-4 rounded-md border border-stone-200 bg-white p-4 sm:grid-cols-3"><Field label="QR Code"><select value={qrCodeId} onChange={(event) => setQrCodeId(event.target.value)} className={inputClass}>{data.qrCodes.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.state}</option>)}</select></Field><Field label="綁定行程"><select value={qrScheduleId} onChange={(event) => setQrScheduleId(event.target.value)} className={inputClass}><option value="">解除行程綁定</option>{data.schedules.filter((schedule) => ["SCHEDULED", "OPEN", "DELAYED"].includes(schedule.status)).map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.marketEvent?.name ?? schedule.location?.name ?? "行程"} · {formatShortDate(schedule.startsAt)}</option>)}</select></Field><Field label="點餐類型"><select disabled={Boolean(qr?.diningTableId) || !qrScheduleId} value={qr?.diningTableId ? "DINE_IN" : qrFulfillmentType} onChange={(event) => setQrFulfillmentType(event.target.value as typeof qrFulfillmentType)} className={inputClass}><option value="TAKEOUT">外帶</option><option value="DINE_IN">內用</option><option value="DELIVERY">外送</option></select></Field><div className="sm:col-span-3 sm:text-right"><button type="button" disabled={busy || !qrCodeId || reason.trim().length < 3} onClick={() => void bindQr()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Link2 className="h-4 w-4" />套用 QR 綁定</button></div></div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-stone-600">{label}{children}</label>; }
function Status({ status }: { status: ScheduleStatus }) { const labels = { SCHEDULED: "預定", OPEN: "營業中", DELAYED: "延遲", CANCELLED: "已取消", COMPLETED: "已結束" }; return <span className={`text-xs font-semibold ${status === "OPEN" ? "text-teal-700" : status === "DELAYED" ? "text-amber-700" : "text-stone-500"}`}>{labels[status]}</span>; }
function toDateTimeLocal(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function formatRange(start: string, end: string) { const formatter = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); return `${formatter.format(new Date(start))}～${formatter.format(new Date(end))}`; }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
const inputClass = "mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950 disabled:bg-stone-100";
const actionClass = "min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold text-teal-800";
