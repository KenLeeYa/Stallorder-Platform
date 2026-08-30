"use client";

import { useState } from "react";
import { Clock3, LocateFixed, LoaderCircle, MapPinCheck, ShieldAlert } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { attendanceRiskLabel, collectBestPosition } from "@/lib/attendance-client";

type EventItem = { id: string; eventType: string; decision: string; riskCodes: string[]; occurredAt: string; distanceMeters: number | null; accuracyMeters: number | null };
export type EmployeeAttendanceData = { state: "CLOCKED_IN" | "CLOCKED_OUT"; policy: { radiusMeters: number; maxAccuracyMeters: number; requireRotatingCode: boolean }; challenge: { token: string; expiresAt: string }; records: EventItem[] };

export function EmployeeAttendance({ stallSlug, initialData }: { stallSlug: string; initialData: EmployeeAttendanceData }) {
  const [data, setData] = useState(initialData);
  const [rotatingCode, setRotatingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/attendance`, { cache: "no-store" });
    const body = await response.json() as EmployeeAttendanceData & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "無法更新打卡狀態。 ");
    setData(body);
  };

  const punch = async () => {
    setBusy(true); setMessage("正在取得 3 次定位樣本…");
    try {
      const position = await collectBestPosition();
      setMessage(`定位精度約 ${Math.round(position.coords.accuracy)} 公尺，正在由伺服器驗證…`);
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/attendance`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          eventType: data.state === "CLOCKED_IN" ? "CLOCK_OUT" : "CLOCK_IN",
          challengeToken: data.challenge.token,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
          rotatingCode: data.policy.requireRotatingCode ? rotatingCode : undefined,
          clientPlatform: "WEB",
        }),
      });
      const body = await response.json() as { error?: string; event?: EventItem };
      if (!response.ok && !body.event) throw new Error(body.error ?? "打卡失敗。 ");
      if (body.event?.decision === "ACCEPTED") setMessage("打卡成功。 ");
      else if (body.event?.decision === "REVIEW_REQUIRED") setMessage("偵測到遲到或早退，已送交主管覆核；正常打卡不需主管核准。");
      else setMessage(`打卡已阻擋：${body.event?.riskCodes.map(attendanceRiskLabel).join("、") || body.error || "驗證未通過"}`);
      setRotatingCode("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打卡失敗。 ");
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  };

  return <div className="space-y-5"><section className="rounded-xl border border-stone-200 bg-white p-5 text-center shadow-sm sm:p-8"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-teal-50 text-teal-800"><MapPinCheck className="h-7 w-7" /></div><p className="mt-4 text-sm font-semibold text-stone-500">目前狀態</p><h2 className="mt-1 text-2xl font-bold">{data.state === "CLOCKED_IN" ? "已上班" : "尚未上班"}</h2><p className="mt-2 text-sm text-stone-600">有效半徑 {data.policy.radiusMeters} 公尺 · 可接受誤差 {data.policy.maxAccuracyMeters} 公尺</p>{data.policy.requireRotatingCode ? <label className="mx-auto mt-5 grid max-w-sm gap-2 text-left text-sm font-semibold">店內動態驗證碼<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={rotatingCode} onChange={(event) => setRotatingCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位數驗證碼" className="h-14 rounded-md border border-stone-300 px-4 text-center font-mono text-2xl tracking-[0.2em]" /></label> : null}<button type="button" disabled={busy || (data.policy.requireRotatingCode && rotatingCode.length !== 6)} onClick={() => void punch()} className="mt-5 inline-flex min-h-14 w-full max-w-sm items-center justify-center gap-2 rounded-md bg-teal-800 px-5 text-lg font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <LocateFixed className="h-6 w-6" />}{data.state === "CLOCKED_IN" ? "下班打卡" : "上班打卡"}</button>{message ? <p role="status" className="mx-auto mt-4 max-w-lg text-sm font-medium leading-6 text-stone-700">{message}</p> : null}<div className="mx-auto mt-5 flex max-w-lg items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs leading-5 text-amber-950"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>定位僅在您主動按下打卡時取得。網頁版以店內動態碼、一次性驗證、裝置 Session 與位置合理性共同防護。</span></div></section><section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><Clock3 className="h-5 w-5 text-teal-700" />今日紀錄</h2><div className="mt-4 divide-y divide-stone-200">{data.records.map((record) => <article key={record.id} className="flex items-center justify-between gap-3 py-4"><div><p className="font-semibold">{record.eventType === "CLOCK_IN" ? "上班" : "下班"}</p><p className="mt-1 text-sm text-stone-500">{new Intl.DateTimeFormat("zh-TW", { timeStyle: "short" }).format(new Date(record.occurredAt))}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${record.decision === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" : record.decision === "REJECTED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{record.decision === "ACCEPTED" ? "已接受" : record.decision === "REJECTED" ? "已阻擋" : "待覆核"}</span></article>)}{data.records.length === 0 ? <p className="py-8 text-sm text-stone-500">今天尚無打卡紀錄。</p> : null}</div></section></div>;
}
