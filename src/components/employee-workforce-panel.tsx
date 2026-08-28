"use client";

import { type FormEvent, useState } from "react";
import { CalendarDays, LoaderCircle } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { getEmployeeWorkforceSnapshot } from "@/server/workforce/workforce-service";

type Snapshot = Awaited<ReturnType<typeof getEmployeeWorkforceSnapshot>>;

const leaveLabels: Record<string, string> = {
  DAY_OFF: "排休",
  ANNUAL: "特別休假",
  PERSONAL: "事假",
  SICK: "病假",
  FAMILY: "家庭照顧假",
  OTHER: "其他",
};

export function EmployeeWorkforcePanel({ stallSlug, initialData }: { stallSlug: string; initialData: Snapshot }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendCommand(command: Record<string, unknown>, successMessage: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/workforce`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as Snapshot & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "目前無法更新休假申請。");
      setData(payload);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新休假申請。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function requestLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const ok = await sendCommand({
      operation: "CREATE_LEAVE_REQUEST",
      leaveType: values.get("leaveType"),
      startDate: values.get("startDate"),
      endDate: values.get("endDate"),
      reason: values.get("reason") || null,
    }, "休假申請已送出，等待主管核准。");
    if (ok) form.reset();
  }

  return <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarDays className="h-5 w-5 text-teal-700" />排班與休假</h2><div className="mt-4 grid gap-5 lg:grid-cols-2"><div><h3 className="font-semibold">近期班表</h3><div className="mt-2 space-y-2">{data.schedules.map((schedule) => <article key={schedule.id} className="rounded-lg border border-stone-200 p-3 text-sm"><p className="font-semibold">{schedule.workDate} · {dayTypeLabel(schedule.dayType)}</p><p className="mt-1 text-stone-600">{schedule.shiftStartAt && schedule.shiftEndAt ? `${time(schedule.shiftStartAt)} ～ ${time(schedule.shiftEndAt)} · 休息 ${schedule.unpaidBreakMinutes} 分鐘` : "本日排休／無指定班次"}</p>{schedule.note ? <p className="mt-1 text-stone-500">{schedule.note}</p> : null}</article>)}{!data.schedules.length ? <p className="text-sm text-stone-600">目前沒有近期班表。</p> : null}</div></div><form onSubmit={requestLeave} className="rounded-lg bg-stone-50 p-4"><h3 className="font-semibold">申請排休／休假</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-medium">假別<select name="leaveType" className="min-h-11 rounded-md border border-stone-300 bg-white px-3">{Object.entries(leaveLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">開始日<input name="startDate" type="date" required className="min-h-11 rounded-md border border-stone-300 px-3" /></label><label className="grid gap-1 text-sm font-medium">結束日<input name="endDate" type="date" required className="min-h-11 rounded-md border border-stone-300 px-3" /></label><label className="grid gap-1 text-sm font-medium">說明（選填）<input name="reason" maxLength={500} className="min-h-11 rounded-md border border-stone-300 px-3" /></label></div><button disabled={busy} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}送出申請</button>{message ? <p role="status" className="mt-3 text-sm text-stone-700">{message}</p> : null}</form></div><div className="mt-5 border-t border-stone-200 pt-4"><h3 className="font-semibold">申請紀錄</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{data.leaveRequests.map((request) => <article key={request.id} className="rounded-lg border border-stone-200 p-3 text-sm"><div className="flex justify-between gap-2"><strong>{leaveLabels[request.leaveType] ?? request.leaveType}</strong><span>{statusLabel(request.status)}</span></div><p className="mt-1 text-stone-600">{request.startDate} ～ {request.endDate}</p>{request.reviewNote ? <p className="mt-1 text-stone-500">主管：{request.reviewNote}</p> : null}{request.status === "PENDING" ? <button type="button" disabled={busy} onClick={() => void sendCommand({ operation: "CANCEL_LEAVE_REQUEST", leaveRequestId: request.id }, "休假申請已取消；可重新送出調整後的日期。") } className="mt-3 min-h-10 rounded-md border border-red-300 px-3 font-semibold text-red-700 disabled:opacity-50">取消申請</button> : null}</article>)}{!data.leaveRequests.length ? <p className="text-sm text-stone-600">尚無休假申請。</p> : null}</div></div></section>;
}

function time(value: string) { return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Taipei" }).format(new Date(value)); }
function dayTypeLabel(value: string) { return ({ WORKDAY: "工作日", REST_DAY: "休息日", REGULAR_DAY_OFF: "例假日", NATIONAL_HOLIDAY: "國定假日" } as Record<string, string>)[value] ?? value; }
function statusLabel(value: string) { return ({ PENDING: "待審", APPROVED: "已核准", REJECTED: "已拒絕", CANCELLED: "已取消" } as Record<string, string>)[value] ?? value; }
