"use client";

import { useCallback, useEffect, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";

type Job = { id: string; order_id: string; stall_id?: string; stall_name?: string; template_code: string; outcome: string; attempt_count: number; last_error_code: string | null; sent_at: string | null; next_attempt_at: string | null };
type Sender = { id: string; status: string; quota_limit: number | null; quota_usage: number | null; quota_checked_at: string | null; paused_until: string | null; worker_error: string | null };
type Data = { configured?: boolean; enabled?: boolean; integrations?: Sender[]; jobs?: Job[] };
type Stall = { id: string; name: string; enabled: boolean; cutover_at: string | null };
const states: Record<string,string> = { QUEUED:"等待處理",IN_FLIGHT:"處理中",PROVIDER_ACCEPTED:"LINE 已接受",RETRY_SCHEDULED:"等待重試",FAILED:"發送失敗",SUPPRESSED:"已停止發送",QUOTA_BLOCKED:"配額不足",MANUAL_REVIEW:"結果待人工確認" };
const events: Record<string,string> = { ORDER_RECEIPT_AVAILABLE:"訂單成立",ORDER_READY:"可以取餐",ORDER_PICKED_UP:"已完成取餐",ORDER_CANCELLED:"訂單取消" };
const reasons: Record<string,string> = { FRIEND_NOT_CONFIRMED:"尚未確認好友關係",MEMBER_NOT_ELIGIBLE:"會員未同意或已停用",ORDER_NO_LONGER_READY:"訂單已不是可取餐狀態",ORDER_NO_LONGER_ACTIVE:"訂單已取消或失效",PAYMENT_NOT_SETTLED:"付款結果尚未確定",PICKUP_CREDENTIAL_UNAVAILABLE:"取餐憑證不可用",PICKUP_SNAPSHOT_STALE:"取餐碼已更新或失效；請由訂單詳情取得最新取餐碼",RETRY_WINDOW_EXPIRED:"重試期限已過",WORKER_LEASE_EXPIRED:"工作逾時，等待恢復",PLATFORM_NOTIFICATION_PROCESSING_FAILED:"處理失敗，請聯絡平台管理員" };
const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"}) : "—";
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

export function LinePlatformNotificationDashboard({ stallId,stallName }: { stallId?: string; stallName?: string }) {
  const endpoint = stallId ? `/api/merchant/stalls/${stallId}/notifications` : "/api/admin/line-platform/notifications";
  const [data,setData] = useState<Data | null>(null);
  const [stalls,setStalls] = useState<Stall[]>([]);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const [retry,setRetry] = useState<Job | null>(null);
  const [reason,setReason] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint,{ cache:"no-store" });
    if (!response.ok) throw new Error("讀取失敗，請確認登入與門市管理權限。");
    setData(await response.json());
    if (!stallId) {
      const rollout = await fetch("/api/admin/line-platform/stalls",{cache:"no-store"});
      if (rollout.ok) setStalls((await rollout.json()).stalls ?? []);
    }
  },[endpoint,stallId]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint,{cache:"no-store",signal:controller.signal}).then(response=>{
      if (!response.ok) throw new Error("讀取失敗，請確認登入與門市管理權限。");
      return response.json();
    }).then(setData).catch(error=>{if(!controller.signal.aborted)setNotice(error.message);});
    if (!stallId) void fetch("/api/admin/line-platform/stalls",{cache:"no-store",signal:controller.signal})
      .then(response=>response.ok ? response.json() : {stalls:[]}).then(result=>setStalls(result.stalls ?? []))
      .catch(()=>{if(!controller.signal.aborted)setNotice("門市啟用清單讀取失敗，請重新整理。");});
    return ()=>controller.abort();
  },[endpoint,stallId]);
  async function act(url: string,body: unknown,success: string) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url,{method:"POST",headers:csrfHeaders(),body:JSON.stringify(body)});
      if (!response.ok) throw new Error(response.status===409 ? "此操作目前不適用。請重新整理；未知結果、已接受或過期通知不能補發。" : "操作失敗，請確認權限後再試。");
      setRetry(null); setReason(""); await refresh(); setNotice(success);
    } catch (error) { setNotice(error instanceof Error ? error.message : "操作失敗。"); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{stallName ? `${stallName}・訂單通知` : "平台 LINE 通知"}</h1><p className="mt-2 text-sm text-slate-600">「LINE 已接受」表示 LINE 接受請求，並不代表顧客已收到或已讀。通知不會代替付款與取餐核銷。</p></div><button className={button} disabled={busy} onClick={()=>void refresh().catch(error=>setNotice(error.message))}>重新整理</button></header>
    {notice && <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-950">{notice}</p>}
    {!data && !notice && <p role="status">正在讀取通知狀態…</p>}
    {!stallId && data && <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-semibold">平台帳號與共用配額</h2><p>{data.configured===false ? "尚未設定平台 LINE 帳號。" : data.enabled ? "通知功能已啟用" : "通知功能已暫停"}</p>
      {(data.integrations ?? []).map(sender=><div key={sender.id} className="space-y-1 text-sm"><p>配額使用：{sender.quota_usage ?? "尚未取得"} / {sender.quota_limit ?? "未取得或無上限"}</p><p>最後查詢：{time(sender.quota_checked_at)}　暫停至：{time(sender.paused_until)}</p>{sender.worker_error && <p role="alert" className="font-medium text-red-700">{sender.worker_error==="PLATFORM_SENDER_UNVERIFIED" ? "平台 LINE 帳號驗證失敗，已停止發送。請檢查伺服器憑證與帳號對應。" : "無法取得平台 LINE 配額，已停止發送，等待重新查詢。"}</p>}</div>)}
      {data.configured && <button disabled={busy} className={button} onClick={()=>void act(endpoint,{operation:"SYNC_REGISTRY"},"已同步伺服器設定的平台帳號。")}>同步平台帳號設定</button>}
    </section>}
    {!stallId && stalls.length>0 && <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-semibold">試營運門市</h2><p className="text-sm text-slate-600">啟用後的新訂單可使用平台 LINE 功能。停用會停止該門市的新通知。</p><div className="grid gap-3 sm:grid-cols-2">{stalls.map(stall=><div key={stall.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{stall.name}</p><p className="text-xs text-slate-500">{stall.enabled ? "已啟用" : "未啟用"} · {time(stall.cutover_at)}</p></div><button className={button} disabled={busy} onClick={()=>void act("/api/admin/line-platform/stalls",{stallId:stall.id,enabled:!stall.enabled},"已更新門市啟用狀態。")}>{stall.enabled ? "停用" : "啟用"}</button></div>)}</div></section>}
    {retry && <form className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5" onSubmit={event=>{event.preventDefault();void act(endpoint,stallId ? {jobId:retry.id,reason} : {operation:"RETRY",jobId:retry.id,stallId:retry.stall_id,reason},"已排入原通知的安全重試。")}}><label className="block font-medium" htmlFor="notification-retry-reason">重試原因</label><p className="text-sm">保留原收件人、訊息內容與重試識別。每次需間隔五分鐘，最多三次；伺服器會重新確認訂單是否適用。</p><input id="notification-retry-reason" className="w-full rounded-lg border p-2" minLength={2} maxLength={200} required value={reason} onChange={event=>setReason(event.target.value)} /><div className="flex gap-2"><button className={button} disabled={busy || reason.trim().length<2}>確認重試</button><button className={button} type="button" onClick={()=>setRetry(null)}>取消</button></div></form>}
    {data && <section className="space-y-3"><h2 className="font-semibold">最近 100 筆通知</h2>{!data.jobs?.length ? <p className="rounded-xl border p-6 text-slate-600">目前沒有平台通知。</p> : <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50"><tr>{["門市／訂單","事件","狀態","時間","操作"].map(label=><th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{data.jobs.map(job=><tr key={job.id} className="border-t"><td className="p-3"><p>{job.stall_name ?? stallName}</p><p className="font-mono text-xs">{job.order_id.slice(0,8)}</p></td><td className="p-3">{events[job.template_code] ?? "訂單通知"}</td><td className="p-3"><p>{states[job.outcome] ?? "待確認"}</p>{job.last_error_code && <p className="mt-1 text-xs text-slate-600">{reasons[job.last_error_code] ?? "發送服務回報異常"}</p>}<p className="text-xs text-slate-500">已嘗試 {job.attempt_count} 次</p></td><td className="p-3">{job.sent_at ? `接受時間：${time(job.sent_at)}` : job.next_attempt_at ? `排程：${time(job.next_attempt_at)}` : "—"}</td><td className="p-3">{["FAILED","QUOTA_BLOCKED","SUPPRESSED"].includes(job.outcome) && <button className={button} disabled={busy} onClick={()=>{setRetry(job);setReason("");}}>安全重試</button>}</td></tr>)}</tbody></table></div>}</section>}
  </main>;
}
