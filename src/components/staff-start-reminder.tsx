"use client";

import { Check, Clock3, LocateFixed, LoaderCircle, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EmployeeAttendanceData } from "@/components/employee-attendance";
import { resolveStaffStartStep } from "@/components/staff-start-reminder-state";
import { readApiJson } from "@/lib/api-response";
import { attendanceRiskLabel, collectBestPosition } from "@/lib/attendance-client";
import { csrfHeaders } from "@/lib/csrf-client";

type AttendanceEvent = {
  decision: string;
  riskCodes: string[];
};

type CashShiftPayload = {
  state: { openShift: { id: string } | null };
  permissions: { canManage: boolean };
  error?: string;
};

export function StaffStartReminder({
  stallSlug,
  canUseAttendance,
  canManageCashShift,
}: {
  stallSlug: string;
  canUseAttendance: boolean;
  canManageCashShift: boolean;
}) {
  const [attendance, setAttendance] = useState<EmployeeAttendanceData | null>(null);
  const [cashShift, setCashShift] = useState<CashShiftPayload | null>(null);
  const [attendanceHandled, setAttendanceHandled] = useState(false);
  const [rotatingCode, setRotatingCode] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNote, setOpeningNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const attendanceButtonRef = useRef<HTMLButtonElement>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);

  const loadAttendance = useCallback(async () => {
    if (!canUseAttendance) return null;
    const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/attendance`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return readApiJson<EmployeeAttendanceData>(response, "目前無法讀取打卡狀態。");
  }, [canUseAttendance, stallSlug]);

  const loadCashShift = useCallback(async () => {
    if (!canManageCashShift) return null;
    const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/cash-shifts`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return readApiJson<CashShiftPayload>(response, "目前無法讀取現金開班狀態。");
  }, [canManageCashShift, stallSlug]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadAttendance(), loadCashShift()]).then(([nextAttendance, nextCashShift]) => {
      if (!active) return;
      setAttendance(nextAttendance);
      setCashShift(nextCashShift);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [loadAttendance, loadCashShift]);

  const step = useMemo(() => resolveStaffStartStep({
    attendanceAvailable: attendance !== null,
    attendanceState: attendance?.state ?? null,
    attendanceHandled,
    cashShiftAvailable: Boolean(cashShift?.permissions.canManage),
    hasOpenCashShift: Boolean(cashShift?.state.openShift),
  }), [attendance, attendanceHandled, cashShift]);

  useEffect(() => {
    if (!step || dismissed) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (step === "ATTENDANCE") attendanceButtonRef.current?.focus();
      else cashInputRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDismissed(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, dismissed, step]);

  async function clockIn() {
    if (!attendance) return;
    setBusy(true);
    setMessage("正在取得定位並由伺服器驗證…");
    try {
      const position = await collectBestPosition();
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/attendance`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          eventType: "CLOCK_IN",
          challengeToken: attendance.challenge.token,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
          rotatingCode: attendance.policy.requireRotatingCode ? rotatingCode : undefined,
          clientPlatform: "WEB",
        }),
      });
      const payload = await readApiJson<{ event?: AttendanceEvent; error?: string }>(response, "上班打卡失敗。");
      if (!payload.event) throw new Error(payload.error ?? "上班打卡失敗。");
      if (payload.event.decision === "REJECTED") {
        throw new Error(`打卡已阻擋：${payload.event.riskCodes.map(attendanceRiskLabel).join("、") || payload.error || "驗證未通過"}`);
      }
      setAttendanceHandled(true);
      setRotatingCode("");
      setMessage(payload.event.decision === "ACCEPTED"
        ? "打卡成功，接著完成現金開班。"
        : "打卡已送交主管覆核，接著完成現金開班。");
      const refreshed = await loadAttendance().catch(() => null);
      if (refreshed) setAttendance(refreshed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上班打卡失敗。");
      const refreshed = await loadAttendance().catch(() => null);
      if (refreshed) setAttendance(refreshed);
    } finally {
      setBusy(false);
    }
  }

  async function openCashShift() {
    const amount = Number(openingAmount);
    if (!Number.isInteger(amount) || amount < 0) {
      setMessage("請輸入大於或等於 0 的開班備用金。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/cash-shifts`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          operation: "OPEN",
          openingAmount: amount,
          note: openingNote.trim() || null,
        }),
      });
      const payload = await readApiJson<CashShiftPayload>(response, "現金開班失敗。");
      if (!response.ok || !payload.state.openShift) {
        throw new Error(payload.error ?? "現金開班失敗。");
      }
      setCashShift(payload);
      setMessage("");
      setOpeningAmount("");
      setOpeningNote("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "現金開班失敗。");
      const refreshed = await loadCashShift().catch(() => null);
      if (refreshed) setCashShift(refreshed);
    } finally {
      setBusy(false);
    }
  }

  if (dismissed || !step || typeof document === "undefined") return null;
  const attendanceStep = step === "ATTENDANCE";

  return createPortal(
    <div data-testid="staff-start-reminder-backdrop" className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/60 p-3 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="staff-start-reminder-title" className="m-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 text-stone-950 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-teal-800">上班前確認</p>
            <h2 id="staff-start-reminder-title" className="mt-1 text-2xl font-bold">
              {attendanceStep ? "先完成上班打卡" : "接著完成現金開班"}
            </h2>
          </div>
          <button type="button" disabled={busy} onClick={() => setDismissed(true)} aria-label="稍後處理" title="稍後處理" className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-2 text-sm font-semibold" aria-label="上班前確認進度">
          <li className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 ${attendanceStep ? "border-teal-700 bg-teal-50 text-teal-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}><Check className="h-4 w-4" />1. 上班打卡</li>
          <li className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 ${!attendanceStep ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-200 text-stone-500"}`}><WalletCards className="h-4 w-4" />2. 現金開班</li>
        </ol>

        {message ? <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-950">{message}</p> : null}

        {attendanceStep && attendance ? (
          <div className="mt-5">
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700"><Clock3 className="mb-2 h-6 w-6 text-teal-700" />系統只會在您按下打卡時取得定位，完成後會自動進入現金開班。</div>
            {attendance.policy.requireRotatingCode ? <label className="mt-4 grid gap-2 text-sm font-semibold">店內動態驗證碼<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={rotatingCode} onChange={(event) => setRotatingCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位數驗證碼" className="h-14 rounded-md border border-stone-300 px-4 text-center font-mono text-2xl tracking-[0.2em]" /></label> : null}
            <button ref={attendanceButtonRef} type="button" disabled={busy || (attendance.policy.requireRotatingCode && rotatingCode.length !== 6)} onClick={() => void clockIn()} className="mt-5 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-teal-800 px-5 text-lg font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <LocateFixed className="h-6 w-6" />}上班打卡</button>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void openCashShift(); }} className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">開班備用金<input ref={cashInputRef} type="text" inputMode="numeric" pattern="[0-9]{0,9}" maxLength={9} value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="請輸入金額" className="h-14 rounded-md border border-stone-300 px-4 text-lg" /></label>
            <label className="grid gap-2 text-sm font-semibold">備註（選填）<input type="text" maxLength={500} value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} className="h-14 rounded-md border border-stone-300 px-4 text-lg" /></label>
            <button type="submit" disabled={busy || openingAmount === ""} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-lg bg-teal-800 px-5 text-lg font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <WalletCards className="h-6 w-6" />}開始現金班次</button>
          </form>
        )}
        <button type="button" disabled={busy} onClick={() => setDismissed(true)} className="mt-4 min-h-12 w-full rounded-lg border border-stone-300 px-4 font-semibold text-stone-700 disabled:opacity-50">稍後處理</button>
      </section>
    </div>,
    document.body,
  );
}
