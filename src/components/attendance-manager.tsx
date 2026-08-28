"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LocateFixed, LoaderCircle, MapPinCheck, ShieldCheck, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

type Policy = {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  maxAccuracyMeters: number;
  requireRotatingCode: boolean;
  locationEvidenceDays: number;
};

type RecordItem = {
  id: string;
  profileName: string;
  eventType: string;
  decision: string;
  riskCodes: string[];
  occurredAt: string;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
};

export type AttendanceManagerData = {
  policy: Policy;
  rotatingCode: { code: string; expiresAt: string } | null;
  records: RecordItem[];
};

export function AttendanceManager({
  stallId,
  initialData,
}: {
  stallId: string;
  initialData: AttendanceManagerData;
}) {
  const [data, setData] = useState(initialData);
  const [policy, setPolicy] = useState({ ...initialData.policy, requireRotatingCode: true });
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewing, setReviewing] = useState<RecordItem | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/merchant/stalls/${stallId}/attendance`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const next = await response.json() as AttendanceManagerData;
    setData(next);
  }, [stallId]);

  useEffect(() => {
    if (!data.policy.enabled || !data.policy.requireRotatingCode) return;
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [data.policy.enabled, data.policy.requireRotatingCode, refresh]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage("此瀏覽器不支援定位，請改用支援定位的手機或平板。 ");
      return;
    }
    setLocating(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPolicy((current) => ({
          ...current,
          latitude: roundCoordinate(position.coords.latitude),
          longitude: roundCoordinate(position.coords.longitude),
        }));
        setLocating(false);
        setMessage(`已取得店家位置；目前精度約 ${Math.round(position.coords.accuracy)} 公尺。`);
      },
      (error) => {
        setLocating(false);
        setMessage(locationErrorMessage(error));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  };

  const savePolicy = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/attendance`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "UPDATE_POLICY", ...policy, requireRotatingCode: true }),
      });
      const body = await response.json() as AttendanceManagerData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "打卡設定儲存失敗。 ");
      setData(body);
      setPolicy(body.policy);
      setMessage("員工定位打卡設定已更新。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打卡設定儲存失敗。 ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <MapPinCheck className="mt-0.5 h-6 w-6 shrink-0 text-teal-700" />
          <div>
            <h2 className="text-lg font-semibold">定位打卡範圍</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              建議預設 150 公尺；高樓與密集街區可放寬至 200 公尺。系統會同時計算 GPS 精度，不以單一座標硬判。
            </p>
          </div>
        </div>

        <label className="mt-5 flex min-h-12 items-center justify-between gap-4 rounded-lg border border-stone-200 px-4 py-3">
          <span><span className="block font-semibold">啟用員工定位打卡</span><span className="text-xs text-stone-500">停用時員工無法建立新打卡紀錄。</span></span>
          <input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy((current) => ({ ...current, enabled: event.target.checked }))} className="h-5 w-5 accent-teal-700" />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField label="店家緯度" value={policy.latitude} min={-90} max={90} step="0.000001" onChange={(latitude) => setPolicy((current) => ({ ...current, latitude }))} />
          <NumberField label="店家經度" value={policy.longitude} min={-180} max={180} step="0.000001" onChange={(longitude) => setPolicy((current) => ({ ...current, longitude }))} />
          <label className="grid gap-1.5 text-sm font-semibold">有效半徑
            <select value={policy.radiusMeters} onChange={(event) => setPolicy((current) => ({ ...current, radiusMeters: Number(event.target.value) }))} className="h-12 rounded-md border border-stone-300 bg-white px-3 font-normal">
              <option value={100}>100 公尺（空曠、單層店面）</option>
              <option value={150}>150 公尺（建議）</option>
              <option value={200}>200 公尺（高樓、密集街區）</option>
              <option value={300}>300 公尺（特殊場域）</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">可接受定位誤差
            <select value={policy.maxAccuracyMeters} onChange={(event) => setPolicy((current) => ({ ...current, maxAccuracyMeters: Number(event.target.value) }))} className="h-12 rounded-md border border-stone-300 bg-white px-3 font-normal">
              <option value={50}>50 公尺（嚴格）</option>
              <option value={80}>80 公尺（建議）</option>
              <option value={120}>120 公尺（高樓環境）</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">定位證據保留
            <select value={policy.locationEvidenceDays} onChange={(event) => setPolicy((current) => ({ ...current, locationEvidenceDays: Number(event.target.value) }))} className="h-12 rounded-md border border-stone-300 bg-white px-3 font-normal">
              <option value={30}>30 天</option>
              <option value={90}>90 天（建議）</option>
              <option value={180}>180 天</option>
              <option value={365}>365 天</option>
            </select>
          </label>
          <div className="flex min-h-12 items-center gap-3 rounded-md border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-950 sm:self-end">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            Web 打卡固定要求店內動態驗證碼
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5" />偽定位防護</p>
          <p className="mt-1">Web 無法直接讀取手機系統的「模擬定位」旗標，因此系統固定要求店內動態驗證碼，並阻擋過期定位、範圍外定位、裝置／Session 不符與不合理移動速度。若需要系統層級偽定位偵測，須使用受管理的原生 App。</p>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={locating} onClick={useCurrentLocation} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-teal-700 px-4 font-semibold text-teal-800 disabled:opacity-50">
            {locating ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}使用目前位置
          </button>
          <button type="button" disabled={busy} onClick={() => void savePolicy()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-teal-800 px-4 font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}儲存打卡設定
          </button>
        </div>
        {message ? <p role="status" className="mt-3 text-sm font-medium text-stone-700">{message}</p> : null}
      </section>

      {data.rotatingCode ? (
        <section className="rounded-xl border border-teal-200 bg-teal-50 p-5 text-center">
          <p className="text-sm font-semibold text-teal-900">店內動態驗證碼</p>
          <p className="mt-2 font-mono text-4xl font-bold tracking-[0.25em] text-teal-950">{data.rotatingCode.code}</p>
          <p className="mt-2 text-xs text-teal-800">每 60 秒更新；僅提供現場員工使用。</p>
        </section>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">今日打卡紀錄</h2><p className="mt-1 text-sm text-stone-500">預設僅讀取當日最多 200 筆，避免大量資料拖慢頁面。</p></div>
          <button type="button" onClick={() => void refresh()} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">重新整理</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.records.map((record) => (
            <article key={record.id} className="rounded-lg border border-stone-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{record.profileName}</p><p className="mt-1 text-sm text-stone-500">{formatTime(record.occurredAt)} · {record.eventType === "CLOCK_IN" ? "上班" : "下班"}</p></div>
                <DecisionBadge decision={record.decision} />
              </div>
              <p className="mt-3 text-sm text-stone-600">距離 {formatMeters(record.distanceMeters)} · 精度 {formatMeters(record.accuracyMeters)}</p>
              {record.riskCodes.length > 0 ? <p className="mt-2 text-xs leading-5 text-amber-800">{record.riskCodes.map(riskLabel).join("、")}</p> : null}
              {record.reviewNote ? <p className="mt-2 text-xs text-stone-500">覆核：{record.reviewNote}</p> : null}
              {record.decision === "REVIEW_REQUIRED" ? <button type="button" onClick={() => setReviewing(record)} className="mt-3 min-h-10 w-full rounded-md border border-amber-500 px-3 text-sm font-semibold text-amber-900">進行人工覆核</button> : null}
            </article>
          ))}
          {data.records.length === 0 ? <p className="py-8 text-sm text-stone-500">今天尚無打卡紀錄。</p> : null}
        </div>
      </section>

      {reviewing ? <AttendanceReviewDialog stallId={stallId} record={reviewing} onClose={() => setReviewing(null)} onUpdated={(next) => { setData(next); setReviewing(null); }} /> : null}
    </div>
  );
}

function AttendanceReviewDialog({ stallId, record, onClose, onUpdated }: { stallId: string; record: RecordItem; onClose: () => void; onUpdated: (data: AttendanceManagerData) => void }) {
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED">("ACCEPTED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    noteRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/attendance`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({ operation: "REVIEW_EVENT", eventId: record.id, decision, note }) });
      const body = await response.json() as AttendanceManagerData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "覆核失敗。 ");
      onUpdated(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "覆核失敗。 "); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/65 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="attendance-review-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 id="attendance-review-title" className="text-xl font-semibold">覆核 {record.profileName} 的打卡</h2><p className="mt-1 text-sm text-stone-500">{formatTime(record.occurredAt)} · {record.eventType === "CLOCK_IN" ? "上班" : "下班"}</p></div><button type="button" onClick={onClose} aria-label="關閉覆核視窗" className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><X className="h-5 w-5" /></button></div><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" aria-pressed={decision === "ACCEPTED"} onClick={() => setDecision("ACCEPTED")} className={`min-h-12 rounded-md border font-semibold ${decision === "ACCEPTED" ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300"}`}>核准</button><button type="button" aria-pressed={decision === "REJECTED"} onClick={() => setDecision("REJECTED")} className={`min-h-12 rounded-md border font-semibold ${decision === "REJECTED" ? "border-red-600 bg-red-50 text-red-800" : "border-stone-300"}`}>拒絕</button></div><label className="mt-4 grid gap-2 text-sm font-semibold">覆核原因<textarea ref={noteRef} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={4} className="rounded-md border border-stone-300 p-3 font-normal" /></label>{error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}<button type="button" disabled={busy || note.trim().length < 2} onClick={() => void submit()} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}確認覆核</button></section></div>;
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number | null; min: number; max: number; step: string; onChange: (value: number | null) => void }) { return <label className="grid gap-1.5 text-sm font-semibold">{label}<input type="number" value={value ?? ""} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} className="h-12 rounded-md border border-stone-300 px-3 font-normal" /></label>; }
function DecisionBadge({ decision }: { decision: string }) { const copy = decision === "ACCEPTED" ? "已接受" : decision === "REJECTED" ? "已阻擋" : "待覆核"; const color = decision === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" : decision === "REJECTED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>{copy}</span>; }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatMeters(value: number | null) { return value === null ? "已清除" : `${Math.round(value)} 公尺`; }
function roundCoordinate(value: number) { return Math.round(value * 1_000_000) / 1_000_000; }
function locationErrorMessage(error: GeolocationPositionError) { if (error.code === error.PERMISSION_DENIED) return "定位權限被拒絕，請在瀏覽器網站設定中允許定位。"; if (error.code === error.TIMEOUT) return "定位逾時，請移至窗邊或空曠處後再試。"; return "無法取得定位，請確認 GPS 與網路後再試。"; }
function riskLabel(code: string) { return ({ LOCATION_STALE: "定位資料過期", LOCATION_FUTURE: "定位時間異常", ACCURACY_TOO_POOR: "定位精度不足", OUTSIDE_GEOFENCE: "超出打卡範圍", GEOFENCE_BOUNDARY: "位於範圍邊界", ROTATING_CODE_INVALID: "動態驗證碼不正確", DEVICE_NOT_BOUND: "裝置登入綁定失效", IMPOSSIBLE_TRAVEL: "偵測到不合理位置跳躍", HIGH_TRAVEL_SPEED: "移動速度異常", ALREADY_CLOCKED_IN: "已是上班狀態", NOT_CLOCKED_IN: "尚未上班打卡" } as Record<string, string>)[code] ?? code; }
