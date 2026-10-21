"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { OPERATIONS_AUTH_INVALIDATED } from "@/lib/operations-query";

type Policy = "MERCHANT_OA" | "PLATFORM_OA";
type Integration = { integrationId: string; organizationId: string; stallId: string; stallName: string; configured: boolean;
  environment?: string; expectedVersion?: number; channelBinding?: string; channelLabel?: string;
  callbackUrl?: string; senderPolicy?: Policy; localMock?: boolean; status?: string; localMockAvailable?: boolean };
type Tested = { testedDigest: string; expectedVersion: number; expiresAt: string;
  diff: { callbackUrl: { before: string; after: string }; senderPolicy: { before: Policy; after: Policy } } };
type Job = { id: string; organization_id: string; stall_id: string; stall_name: string; order_id: string;
  outcome: string; attempt_count: number; last_error_code: string | null };
const endpoint = "/api/admin/line-platform/webhooks";
const notifications = "/api/admin/line-platform/notifications";
const button = "min-h-12 min-w-12 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const policyLabel = (policy: Policy) => policy === "MERCHANT_OA" ? "商家 OA（預設停用）" : "平台 OA（管理員替代方案，停用）";
const outcomeLabel: Record<string,string> = { QUEUED: "等待處理", RETRY_SCHEDULED: "等待重試", IN_FLIGHT: "處理中", FAILED: "終止失敗", MANUAL_REVIEW: "UNKNOWN・待人工確認", SUPPRESSED: "已暫停", SIMULATED: "Mock 已完成" };

export function LineWebhookManagement() {
  const [integrations,setIntegrations] = useState<Integration[]>([]),[jobs,setJobs] = useState<Job[]>([]);
  const [selected,setSelected] = useState(""),[callback,setCallback] = useState(""),[policy,setPolicy] = useState<Policy>("MERCHANT_OA");
  const [tested,setTested] = useState<Tested | null>(null),[busy,setBusy] = useState(false),[notice,setNotice] = useState("");
  const [remote,setRemote] = useState<{remoteEndpoint:string;remoteActive:false} | null>(null),[loaded,setLoaded] = useState(false),[denied,setDenied] = useState(false);
  const generation = useRef(0),controllers = useRef(new Set<AbortController>()),authorized = useRef(true);
  const current = integrations.find(row=>row.integrationId===selected);
  const stopPending = useCallback(()=>{generation.current++;authorized.current=false;controllers.current.forEach(controller=>controller.abort());controllers.current.clear();},[]);
  const clearPrivate = useCallback(()=>{
    stopPending();
    setIntegrations([]);setJobs([]);setSelected("");setCallback("");setPolicy("MERCHANT_OA");setTested(null);setRemote(null);setLoaded(false);setBusy(false);setDenied(true);setNotice("權限已改變，請重新登入並開啟此頁。");
  },[stopPending]);
  type Operation = {signal:AbortSignal;check:()=>void};
  const json = useCallback(async(url:string,operation:Operation,body?:unknown)=>{
    operation.check();const response=await fetch(url,{cache:"no-store",signal:operation.signal,...(body===undefined?{}:{method:"POST",headers:csrfHeaders(),body:JSON.stringify(body)})});
    operation.check();if([401,403,404].includes(response.status)){clearPrivate();throw new DOMException("Authority changed","AbortError");}
    if(!response.ok)throw new Error("操作未完成。請重新讀取設定與測試；通知仍維持停用。");
    const result=await response.json();operation.check();return result;
  },[clearPrivate]);
  const run = useCallback(async(action:(operation:Operation)=>Promise<void>)=>{
    if(!authorized.current)return;const epoch=generation.current,controller=new AbortController();controllers.current.add(controller);setBusy(true);setNotice("");
    const check=()=>{if(controller.signal.aborted||epoch!==generation.current||!authorized.current)throw new DOMException("Stale response","AbortError");};
    try{await action({signal:controller.signal,check});}
    catch(error){if(epoch===generation.current&&!controller.signal.aborted){setTested(null);setNotice(error instanceof Error?error.message:"操作失敗。");}}
    finally{controllers.current.delete(controller);if(epoch===generation.current)setBusy(false);}
  },[]);
  const refresh = useCallback(async(operation:Operation)=>{
    const [management,queue]=await Promise.all([json(endpoint,operation),json(notifications+"?mode=LEGACY",operation)]);operation.check();
    setIntegrations(management.integrations);setJobs(queue.jobs);setTested(null);setRemote(null);setLoaded(true);
  },[json]);
  useEffect(()=>{
    authorized.current=true;void run(refresh);window.addEventListener(OPERATIONS_AUTH_INVALIDATED,clearPrivate);
    return()=>{stopPending();window.removeEventListener(OPERATIONS_AUTH_INVALIDATED,clearPrivate);};
  },[clearPrivate,refresh,run,stopPending]);
  function choose(id:string){const row=integrations.find(item=>item.integrationId===id);setSelected(id);setCallback(row?.callbackUrl??"");setPolicy(row?.senderPolicy??"MERCHANT_OA");setTested(null);setRemote(null);setNotice("");}
  async function readSelected(){if(!current)return;await run(async operation=>{
    const result=await json(endpoint+"?integrationId="+encodeURIComponent(current.integrationId),operation);setRemote(result);setTested(null);
    setIntegrations(rows=>rows.map(row=>row.integrationId===current.integrationId?{...row,...result}:row));setCallback(result.callbackUrl);setPolicy(result.senderPolicy);setNotice("已讀取目前 Mock 設定；Webhook 維持停用。");
  });}
  async function manage(operation:"TEST"|"APPLY"){
    if(!current)return;await run(async execution=>{
      const target={integrationId:current.integrationId,organizationId:current.organizationId,stallId:current.stallId,environment:current.environment,channelBinding:current.channelBinding,expectedVersion:operation==="APPLY"?tested?.expectedVersion:current.expectedVersion};
      const result=await json(endpoint,execution,operation==="TEST"?{...target,operation,callbackUrl:callback,senderPolicy:policy}:{...target,operation,testedDigest:tested?.testedDigest});
      if(operation==="TEST"){setTested(result);setIntegrations(rows=>rows.map(row=>row.integrationId===current.integrationId?{...row,expectedVersion:result.expectedVersion}:row));setNotice("Mock 測試通過。請核對下方差異，再明確套用。");}
      else{await refresh(execution);execution.check();setIntegrations(rows=>rows.map(row=>row.integrationId===current.integrationId?{...row,...result}:row));setCallback(result.callbackUrl);setPolicy(result.senderPolicy);setRemote({remoteEndpoint:result.callbackUrl,remoteActive:false});setNotice("已套用並讀回 Mock 設定；Webhook 與真實通知維持停用。");}
    });
  }
  async function reconcile(job:Job){await run(async operation=>{const result=await json(notifications,operation,{operation:"RECONCILE_LEGACY",jobId:job.id,organizationId:job.organization_id,stallId:job.stall_id});await refresh(operation);operation.check();setNotice(result.message);});}
  return <section className="mx-auto max-w-7xl space-y-5 p-4 sm:p-8" aria-labelledby="legacy-line-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="legacy-line-heading" className="text-xl font-bold">商家 LINE 與 Webhook 管理</h2><button type="button" className={button} disabled={busy||denied} onClick={()=>void run(refresh)}>重新讀取設定</button></div>
    <p className="text-sm text-slate-600">新商家 OA 通知能力預設停用；缺少同一 Provider 的收件人證明時暫停發送。以下操作只適用本機 Mock，不會啟用真實 OA、MINI App 或付款功能。</p>
    {notice&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-950">{notice}</p>}
    <label className="block space-y-2"><span className="font-medium">LINE 整合</span><select className="min-h-11 w-full rounded-lg border p-2" value={selected} disabled={busy||denied} onChange={event=>choose(event.target.value)}><option value="">請選擇門市整合</option>{integrations.map(row=><option key={row.integrationId} value={row.integrationId}>{row.stallName} · {row.channelLabel ?? "尚缺 Messaging 綁定"}</option>)}</select></label>
    {current&&<div className="space-y-4 rounded-xl border bg-white p-4">
      <p className="text-sm">環境：{current.environment ?? "未設定"} · Messaging Channel：{current.channelLabel ?? "未設定"} · 版本：{current.expectedVersion ?? "—"}</p>
      {!current.localMockAvailable&&<p role="status">目前整合未啟用或本機 Mock 尚不可用，操作維持停用。</p>}
      {!current.configured&&<p role="alert">缺少可信任 Messaging Channel 綁定，請先完成伺服器設定。</p>}
      <button type="button" className={button} disabled={busy||!current.localMockAvailable} onClick={()=>void readSelected()}>讀取目前 Mock Webhook</button>
      {remote&&<p className="break-all text-sm" data-testid="legacy-webhook-readback">目前 Mock Callback：{remote.remoteEndpoint||"未設定"} · Webhook 停用</p>}
      <label className="block space-y-2"><span className="font-medium">HTTPS Webhook Callback URL</span><input className="min-h-11 w-full rounded-lg border p-2" value={callback} disabled={busy} type="url" maxLength={500} onChange={event=>{setCallback(event.target.value);setTested(null);}} placeholder="https://網站/api/webhooks/line/整合識別" /></label>
      <label className="block space-y-2"><span className="font-medium">發送帳號方案</span><select className="min-h-11 w-full rounded-lg border p-2" value={policy} disabled={busy} onChange={event=>{setPolicy(event.target.value as Policy);setTested(null);}}><option value="MERCHANT_OA">{policyLabel("MERCHANT_OA")}</option><option value="PLATFORM_OA">{policyLabel("PLATFORM_OA")}</option></select></label>
      <button type="button" className={button} disabled={busy||!current.localMockAvailable||!remote||!callback} onClick={()=>void manage("TEST")}>測試 Mock Webhook</button>
      {tested&&<div className="space-y-3 rounded-lg border border-amber-300 p-4"><h3 className="font-semibold">待套用差異</h3><dl className="space-y-2 break-all text-sm"><div><dt>Callback URL</dt><dd>目前：{tested.diff.callbackUrl.before||"未設定"}</dd><dd>套用後：{tested.diff.callbackUrl.after}</dd></div><div><dt>發送帳號方案</dt><dd>目前：{policyLabel(tested.diff.senderPolicy.before)}</dd><dd>套用後：{policyLabel(tested.diff.senderPolicy.after)}</dd></div></dl><p className="text-sm">此測試十分鐘內有效。套用後仍維持停用。</p><button type="button" className={button} disabled={busy} onClick={()=>void manage("APPLY")}>確認套用已測試差異</button></div>}
    </div>}
    <section className="space-y-3" aria-labelledby="legacy-jobs-heading"><h3 id="legacy-jobs-heading" className="font-semibold">舊版通知狀態（最近 100 筆）</h3>{!loaded?<p>{denied?"私人資料已清除。":busy?"正在讀取通知…":"尚未讀取通知，請重試。"}</p>:jobs.length===0?<p>目前沒有舊版通知。</p>:<ul className="grid gap-3 md:grid-cols-2">{jobs.map(job=><li key={job.id} className="space-y-2 rounded-xl border p-4"><p className="font-medium">{job.stall_name} · 訂單 {job.order_id.slice(0,8)}</p><p>{outcomeLabel[job.outcome]??"待確認"} · 已嘗試 {job.attempt_count} 次</p>{job.outcome==="MANUAL_REVIEW"&&<><p className="text-sm text-slate-600">結果不明，必須取得可信任服務商證據後確認；不會自動補送。</p><button type="button" className={button} disabled={busy} onClick={()=>void reconcile(job)}>確認處理條件</button></>}</li>)}</ul>}</section>
  </section>;
}
