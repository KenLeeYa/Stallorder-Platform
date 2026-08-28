"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  LoaderCircle,
  TriangleAlert,
  UsersRound,
  X,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { getWorkforceDashboard } from "@/server/workforce/workforce-service";

type WorkforceDashboard = Awaited<ReturnType<typeof getWorkforceDashboard>>;

const dayTypeLabels: Record<string, string> = {
  WORKDAY: "一般工作日",
  REST_DAY: "休息日",
  REGULAR_DAY_OFF: "例假日",
  NATIONAL_HOLIDAY: "國定假日",
};
const leaveTypeLabels: Record<string, string> = {
  DAY_OFF: "排休",
  ANNUAL: "特別休假",
  PERSONAL: "事假",
  SICK: "病假",
  FAMILY: "家庭照顧假",
  OTHER: "其他",
};

export function WorkforceManager({
  organizationId,
  initialDashboard,
}: {
  organizationId: string;
  initialDashboard: WorkforceDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const stallOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const employee of dashboard.employees) {
      for (const assignment of employee.assignments) values.set(assignment.stallId, assignment.stallName);
    }
    return [...values.entries()];
  }, [dashboard.employees]);

  async function sendCommand(command: Record<string, unknown>, successMessage: string) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    setFieldErrors({});
    const query = new URLSearchParams({ dateFrom: dashboard.dateFrom, dateTo: dashboard.dateTo });
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/workforce?${query}`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as WorkforceDashboard & { error?: string; fieldErrors?: unknown };
      if (!response.ok || payload.error) {
        setMessage(payload.error ?? "目前無法更新員工薪資資料。");
        setFieldErrors(parseFieldErrors(payload.fieldErrors));
        return false;
      }
      setDashboard(payload);
      setMessage(successMessage);
      return true;
    } catch {
      setMessage("網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(
    event: FormEvent<HTMLFormElement>,
    build: (data: FormData) => Record<string, unknown>,
    successMessage: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const ok = await sendCommand(build(new FormData(form)), successMessage);
    if (ok) form.reset();
  }

  const adjustableLeave = dashboard.leaveRequests.filter((request) => ["PENDING", "APPROVED"].includes(request.status));
  const activeSchedules = dashboard.schedules.filter((schedule) => schedule.status !== "CANCELLED");
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div><h2 className="font-semibold">薪資試算與覆核原則</h2><p className="mt-1">系統以已核准打卡、有效時薪、休息時間與假日倍率產生可稽核試算；不同班制的例假、休息日、加班與有薪假仍需由商家依勞動契約確認，結案前請覆核異常工時。</p></div>
        </div>
      </section>

      <form method="get" className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto]">
        <input type="hidden" name="organizationId" value={organizationId} />
        <Field label="開始日" name="dateFrom" type="date" defaultValue={dashboard.dateFrom} />
        <Field label="結束日" name="dateTo" type="date" defaultValue={dashboard.dateTo} />
        <button type="submit" className="min-h-11 self-end rounded-md bg-stone-950 px-5 text-sm font-semibold text-white">查詢</button>
      </form>

      <section aria-label="員工薪資摘要" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric icon={UsersRound} label="計薪員工" value={`${dashboard.payrollPreview.length} 人`} />
        <Metric icon={Clock3} label="核准工時" value={formatMinutes(dashboard.totals.payableMinutes)} />
        <Metric icon={CircleDollarSign} label="本期薪資試算" value={money(dashboard.totals.grossAmount)} />
        <Metric icon={CalendarDays} label="待審休假／異常" value={`${dashboard.totals.pendingLeaveCount}／${dashboard.anomalies.length}`} />
      </section>

      {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length || message.includes("無法") || message.includes("缺少") ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">本期薪資預覽</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboard.payrollPreview.map((line) => (
            <article key={line.profileId} className={`rounded-lg border p-4 ${line.missingWageRate ? "border-red-300 bg-red-50" : "border-stone-200"}`}>
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{line.profileName}</h3><p className="text-xs text-stone-500">時薪 {money(line.hourlyRate)} · {line.shifts.length} 班</p></div><strong className="text-lg">{money(line.grossAmount)}</strong></div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><Breakdown label="一般" value={formatMinutes(line.regularMinutes)} /><Breakdown label="加班" value={formatMinutes(line.overtimeTier1Minutes + line.overtimeTier2Minutes)} /><Breakdown label="假日" value={formatMinutes(line.holidayMinutes)} /><Breakdown label="加班／假日加給" value={money(line.overtimeAmount + line.holidayAmount)} /></dl>
              {line.missingWageRate ? <p className="mt-3 text-sm font-semibold text-red-700">缺少有效時薪，不能產生薪資單。</p> : null}
            </article>
          ))}
          {!dashboard.payrollPreview.length ? <p className="text-sm text-stone-600">此區間尚無成對且已核准的上下班紀錄。</p> : null}
        </div>
        <button type="button" disabled={busy || !dashboard.payrollPreview.length || dashboard.totals.missingWageRateCount > 0} onClick={() => void sendCommand({ operation: "GENERATE_PAYROLL", periodStart: dashboard.dateFrom, periodEnd: dashboard.dateTo }, "薪資快照已產生，請再次覆核後結案。") } className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"><FileCheck2 className="h-4 w-4" />產生本期薪資單</button>
      </section>

      {dashboard.anomalies.length ? <section className="rounded-xl border border-red-200 bg-red-50 p-4"><h2 className="font-semibold text-red-900">工時覆核提醒</h2><ul className="mt-3 space-y-2 text-sm text-red-900">{dashboard.anomalies.map((warning, index) => <li key={`${warning.occurredAt}-${index}`} className="rounded-md bg-white/70 p-3"><strong>{warning.profileName} · {warning.stallName}</strong><p>{warning.message} · {new Date(warning.occurredAt).toLocaleString("zh-TW")}</p></li>)}</ul></section> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <WorkforceForm title="設定員工時薪" busy={busy} onSubmit={(event) => void submitForm(event, (data) => ({ operation: "SET_WAGE_RATE", profileId: data.get("profileId"), stallId: data.get("stallId") || null, hourlyRate: Number(data.get("hourlyRate")), effectiveFrom: data.get("effectiveFrom"), effectiveTo: data.get("effectiveTo") || null, note: data.get("note") || null }), "員工時薪已更新。") }>
          <SelectField label="員工" name="profileId" options={dashboard.employees.map((employee) => [employee.profileId, employee.displayName])} error={fieldErrors.profileId} />
          <SelectField label="適用攤位" name="stallId" required={false} options={[["", "全部所屬攤位"], ...stallOptions]} error={fieldErrors.stallId} />
          <Field label="時薪（元）" name="hourlyRate" type="number" min="1" step="1" error={fieldErrors.hourlyRate} />
          <Field label="生效日" name="effectiveFrom" type="date" defaultValue={dashboard.dateFrom} error={fieldErrors.effectiveFrom} />
          <Field label="結束日（選填）" name="effectiveTo" type="date" required={false} error={fieldErrors.effectiveTo} />
          <Field label="備註（選填）" name="note" required={false} />
        </WorkforceForm>

        <WorkforceForm title="新增排班／排休日" busy={busy} onSubmit={(event) => void submitForm(event, (data) => ({ operation: "CREATE_SCHEDULE", profileId: data.get("profileId"), stallId: data.get("stallId"), workDate: data.get("workDate"), shiftStartAt: dateTimeOrNull(data.get("shiftStartAt")), shiftEndAt: dateTimeOrNull(data.get("shiftEndAt")), unpaidBreakMinutes: Number(data.get("unpaidBreakMinutes") || 0), dayType: data.get("dayType"), status: "PUBLISHED", note: data.get("note") || null }), "排班已新增。") }>
          <SelectField label="員工" name="profileId" options={dashboard.employees.map((employee) => [employee.profileId, employee.displayName])} error={fieldErrors.profileId} />
          <SelectField label="攤位" name="stallId" options={stallOptions} error={fieldErrors.stallId} />
          <Field label="日期" name="workDate" type="date" defaultValue={dashboard.dateTo} error={fieldErrors.workDate} />
          <SelectField label="日期性質" name="dayType" options={Object.entries(dayTypeLabels)} />
          <Field label="上班時間（排休可留白）" name="shiftStartAt" type="datetime-local" required={false} error={fieldErrors.shiftStartAt} />
          <Field label="下班時間（排休可留白）" name="shiftEndAt" type="datetime-local" required={false} error={fieldErrors.shiftEndAt} />
          <Field label="不計薪休息（分鐘）" name="unpaidBreakMinutes" type="number" min="0" max="480" defaultValue="0" error={fieldErrors.unpaidBreakMinutes} />
          <Field label="備註（選填）" name="note" required={false} />
        </WorkforceForm>

        <WorkforceForm title="國定假日與時薪倍率" busy={busy} onSubmit={(event) => void submitForm(event, (data) => ({ operation: "UPSERT_HOLIDAY", holidayDate: data.get("holidayDate"), name: data.get("name"), multiplierBps: Math.round(Number(data.get("multiplier")) * 10_000), note: data.get("note") || null }), "假日倍率已更新。") }>
          <Field label="日期" name="holidayDate" type="date" error={fieldErrors.holidayDate} />
          <Field label="假日名稱" name="name" placeholder="例：國慶日" />
          <Field label="時薪倍率" name="multiplier" type="number" min="1" max="5" step="0.01" defaultValue="2" error={fieldErrors.multiplierBps} />
          <Field label="備註（選填）" name="note" required={false} />
        </WorkforceForm>

        <WorkforceForm title="薪資計算規則" busy={busy} onSubmit={(event) => void submitForm(event, (data) => ({ operation: "UPDATE_POLICY", regularDayMinutes: Number(data.get("regularDayMinutes")), roundingIncrementMinutes: Number(data.get("roundingIncrementMinutes")), overtimeTier1Minutes: Number(data.get("overtimeTier1Minutes")), overtimeTier1MultiplierBps: Math.round(Number(data.get("overtimeTier1Multiplier")) * 10_000), overtimeTier2MultiplierBps: Math.round(Number(data.get("overtimeTier2Multiplier")) * 10_000), defaultHolidayMultiplierBps: Math.round(Number(data.get("defaultHolidayMultiplier")) * 10_000) }), "薪資計算規則已更新。") }>
          <Field label="一般工時上限（分鐘／日）" name="regularDayMinutes" type="number" min="60" max="720" defaultValue={String(dashboard.policy.regularDayMinutes)} />
          <SelectField label="工時進位單位" name="roundingIncrementMinutes" options={[["1", "1 分鐘"], ["5", "5 分鐘"], ["10", "10 分鐘"], ["15", "15 分鐘"], ["30", "30 分鐘"]]} defaultValue={String(dashboard.policy.roundingIncrementMinutes)} />
          <Field label="第一段加班分鐘" name="overtimeTier1Minutes" type="number" min="0" max="360" defaultValue={String(dashboard.policy.overtimeTier1Minutes)} />
          <Field label="第一段加班倍率" name="overtimeTier1Multiplier" type="number" min="1" max="5" step="0.0001" defaultValue={String(dashboard.policy.overtimeTier1MultiplierBps / 10_000)} />
          <Field label="第二段加班倍率" name="overtimeTier2Multiplier" type="number" min="1" max="5" step="0.0001" defaultValue={String(dashboard.policy.overtimeTier2MultiplierBps / 10_000)} />
          <Field label="預設國定假日倍率" name="defaultHolidayMultiplier" type="number" min="1" max="5" step="0.01" defaultValue={String(dashboard.policy.defaultHolidayMultiplierBps / 10_000)} />
        </WorkforceForm>
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">班表安排</h2><p className="mt-1 text-sm text-stone-600">需要調整時先取消原班表，再新增正確班別，保留變更紀錄。</p><div className="mt-3 grid gap-2 md:grid-cols-2">{activeSchedules.map((schedule) => <article key={schedule.id} className="grid gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-semibold">{schedule.profileName} · {schedule.workDate}</p><p className="text-sm text-stone-600">{dayTypeLabels[schedule.dayType] ?? schedule.dayType}{schedule.shiftStartAt && schedule.shiftEndAt ? ` · ${new Date(schedule.shiftStartAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}～${new Date(schedule.shiftEndAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}` : " · 排休"}</p></div><button type="button" disabled={busy} onClick={() => void sendCommand({ operation: "CANCEL_SCHEDULE", scheduleId: schedule.id }, "原班表已取消，請新增調整後的班別。") } className="min-h-10 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50">取消／調整</button></article>)}{!activeSchedules.length ? <p className="text-sm text-stone-600">此區間尚無已發布班表。</p> : null}</div></section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">休假申請</h2><div className="mt-3 space-y-2">{adjustableLeave.map((request) => <article key={request.id} className="grid gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-semibold">{request.profileName} · {leaveTypeLabels[request.leaveType] ?? request.leaveType}</p><p className="text-sm text-stone-600">{request.startDate} ～ {request.endDate}{request.reason ? ` · ${request.reason}` : ""} · {request.status === "APPROVED" ? "已核准" : "待審"}</p></div><div className="flex flex-wrap gap-2">{request.status === "PENDING" ? <><button type="button" disabled={busy} onClick={() => void sendCommand({ operation: "REVIEW_LEAVE", leaveRequestId: request.id, decision: "APPROVED", reviewNote: null }, "休假申請已核准。") } className="inline-flex min-h-11 items-center gap-1 rounded-md border border-teal-600 px-3 text-sm font-semibold text-teal-800"><Check className="h-4 w-4" />核准</button><button type="button" disabled={busy} onClick={() => void sendCommand({ operation: "REVIEW_LEAVE", leaveRequestId: request.id, decision: "REJECTED", reviewNote: "排班主管拒絕" }, "休假申請已拒絕。") } className="inline-flex min-h-11 items-center gap-1 rounded-md border border-red-500 px-3 text-sm font-semibold text-red-700"><X className="h-4 w-4" />拒絕</button></> : null}<button type="button" disabled={busy} onClick={() => void sendCommand({ operation: "CANCEL_LEAVE", leaveRequestId: request.id, reviewNote: "由排班主管取消／調整" }, "休假安排已取消，可重新申請日期。") } className="min-h-11 rounded-md border border-stone-400 px-3 text-sm font-semibold">取消／調整</button></div></article>)}{!adjustableLeave.length ? <p className="text-sm text-stone-600">目前沒有待審或已核准休假。</p> : null}</div></section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">薪資單歷程</h2><div className="mt-3 space-y-3">{dashboard.payrollPeriods.map((period) => <article key={period.id} className="rounded-lg border border-stone-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{period.periodStart} ～ {period.periodEnd}</p><p className="text-sm text-stone-600">{period.lines.length} 人 · {money(period.totalGrossAmount)}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${period.status === "FINALIZED" ? "bg-teal-100 text-teal-900" : "bg-amber-100 text-amber-900"}`}>{period.status === "FINALIZED" ? "已結案" : "待覆核"}</span>{period.status === "DRAFT" ? <button type="button" disabled={busy} onClick={() => void sendCommand({ operation: "FINALIZE_PAYROLL", payrollPeriodId: period.id }, "薪資單已結案並鎖定快照。") } className="min-h-10 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white">確認結案</button> : null}</div></div></article>)}{!dashboard.payrollPeriods.length ? <p className="text-sm text-stone-600">尚未產生薪資單。</p> : null}</div></section>
    </div>
  );
}

function WorkforceForm({ title, busy, onSubmit, children }: { title: string; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: React.ReactNode }) {
  return <details className="group rounded-xl border border-stone-200 bg-white shadow-sm"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold"><span>{title}</span><span className="text-stone-500 transition-transform group-open:rotate-180">⌄</span></summary><form onSubmit={onSubmit} className="border-t border-stone-200 p-4"><div className="grid gap-3 sm:grid-cols-2">{children}</div><button type="submit" disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}儲存</button></form></details>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof UsersRound; label: string; value: string }) { return <article className="min-w-0 rounded-xl border border-stone-200 bg-white p-3 shadow-sm sm:p-4"><div className="flex items-center gap-2 text-xs text-stone-600 sm:text-sm"><Icon className="h-4 w-4 text-teal-700" />{label}</div><p className="mt-2 break-words text-lg font-semibold tabular-nums sm:text-xl">{value}</p></article>; }
function Breakdown({ label, value }: { label: string; value: string }) { return <div className="rounded-md bg-stone-50 p-2"><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>; }

function Field({ label, name, error, required = true, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) { const errorId = `${name}-error`; return <label className="grid gap-1 text-sm font-medium text-stone-800">{label}<input type={type} name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...props} className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>; }
function SelectField({ label, name, options, error, required = true, defaultValue }: { label: string; name: string; options: readonly (readonly [string, string])[]; error?: string; required?: boolean; defaultValue?: string }) { const errorId = `${name}-error`; return <label className="grid gap-1 text-sm font-medium text-stone-800">{label}<select name={name} required={required} defaultValue={defaultValue} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="min-h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100">{options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select>{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>; }
function money(value: number) { return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value); }
function formatMinutes(value: number) { return `${Math.floor(value / 60)} 小時 ${value % 60} 分`; }
function dateTimeOrNull(value: FormDataEntryValue | null) { const text = String(value ?? ""); return text ? new Date(text).toISOString() : null; }
