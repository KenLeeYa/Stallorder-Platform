"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";

type Payment={attemptId:string;orderId:string;orderNo:string;state:string;paymentStatus:string;amount:number;refundedAmount:number;pendingRefundAmount:number;partialRefundEnabled:boolean;manualReview:boolean;caseCount:number;cases:Array<{id:string;reason:string}>};
const stateLabels:Record<string,string>={REQUESTING:"付款建立中",PENDING_AUTH:"等待顧客授權",CONFIRMING:"付款確認中",UNKNOWN:"付款結果待查核",MANUAL_REVIEW:"需人工查核",SUCCEEDED:"付款已確認",FAILED:"付款失敗",CANCELLED:"付款取消"};
const caseLabels:Record<string,string>={REQUEST_RESULT_UNPROVEN:"付款請求結果尚無法證明",REFUND_RESULT_UNPROVEN:"退款結果尚無法證明",PAID_ORDER_CONFLICT_REQUIRES_COMPENSATION:"付款成功但訂單狀態衝突，需處理補償",RECOVERY_RETRY_EXHAUSTED:"自動查核已達上限"};
export function LinePlatformPaymentOperations({stalls}:{stalls:Array<{id:string;name:string}>}){
  const [stallId,setStallId]=useState(stalls[0]?.id??"");
  return <section className="mt-8 space-y-4 rounded-xl border border-stone-300 bg-white p-4" aria-label="LINE Pay 付款查核與退款">
    <h2 className="text-xl font-semibold">LINE Pay 付款查核與退款</h2>
    <p className="text-sm text-stone-600">Sandbox 測試交易。結果待查核時會保留付款或退款額度，請勿另行重複收退。</p>
    <label className="block text-sm">攤位<select aria-label="LINE Pay 查核攤位" className="ml-3 min-h-11 rounded border px-3" value={stallId} onChange={event=>setStallId(event.target.value)}>{stalls.map(stall=><option key={stall.id} value={stall.id}>{stall.name}</option>)}</select></label>
    {stallId?<StallOperations key={stallId} stallId={stallId}/>:<p>尚無可管理攤位。</p>}
  </section>;
}
function StallOperations({stallId}:{stallId:string}){
  const [payments,setPayments]=useState<Payment[]>([]);const [loaded,setLoaded]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  const [selected,setSelected]=useState<Payment|null>(null);const [reason,setReason]=useState("");const [amount,setAmount]=useState("");const [confirmed,setConfirmed]=useState(false);
  const refundKey=useRef<{fingerprint:string;key:string}|null>(null);
  const fetchPayments=useCallback(async():Promise<Payment[]>=>{
    const response=await fetch(`/api/merchant/payment-integrations/operations?stallId=${stallId}`,{cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error("目前無法載入付款紀錄。");
    return(await response.json()).payments;
  },[stallId]);
  async function reload(){setPayments(await fetchPayments());setLoaded(true);}
  useEffect(()=>{let active=true;void fetchPayments().then(rows=>{if(active){setPayments(rows);setLoaded(true);}}).catch(()=>{if(active)setMessage("目前無法載入付款紀錄，請重新整理。");});return()=>{active=false;};},[fetchPayments]);
  const remaining=selected?selected.amount-selected.refundedAmount-selected.pendingRefundAmount:0;
  const requestedAmount=amount.trim()?Number(amount):remaining;
  const validRefund=Boolean(selected&&reason.trim().length>=3&&Number.isSafeInteger(requestedAmount)&&requestedAmount>0&&requestedAmount<=remaining&&(selected.partialRefundEnabled||requestedAmount===remaining));
  async function operate(payment:Payment,refund=false){
    if(busy||(refund&&(!validRefund||!confirmed)))return;
    setBusy(true);setMessage("");
    const payload=refund?{action:"REFUND",attemptId:payment.attemptId,stallId,reason:reason.trim(),amount:requestedAmount}:{action:"RECONCILE",attemptId:payment.attemptId,stallId};
    if(refund){const fingerprint=JSON.stringify(payload);if(refundKey.current?.fingerprint!==fingerprint)refundKey.current={fingerprint,key:crypto.randomUUID()};}
    try{
      const response=await fetch("/api/merchant/payment-integrations/operations",{method:"POST",credentials:"same-origin",headers:{...csrfHeaders(),...(refund?{"x-idempotency-key":refundKey.current!.key}:{})},body:JSON.stringify(payload)});
      if(!response.ok)throw new Error();
      const result=await response.json();
      setMessage(result.payment.pendingRefundAmount>0?"退款結果仍待查核，金額已保留，請勿重複退款。":refund?"退款結果已更新。":"查核結果已更新。");
      await reload();setSelected(null);setConfirmed(false);if(refund)refundKey.current=null;
    }catch{setMessage("結果尚未確認，請先重新整理或查核。請勿另建退款操作。");setLoaded(false);try{await reload();}catch{/* keep mutations disabled until status is read */}}
    finally{setBusy(false);}
  }
  function selectRefund(payment:Payment){setSelected(payment);setReason("");setAmount("");setConfirmed(false);}
  return <div className="space-y-4">
    <button type="button" disabled={busy} onClick={()=>void reload().catch(()=>setMessage("目前無法載入付款紀錄。"))} className="min-h-11 rounded border px-4">重新整理付款</button>
    {message?<p role="status" className="rounded bg-amber-50 p-3 text-sm">{message}</p>:null}
    {!loaded?<p>正在確認付款紀錄…</p>:payments.length===0?<p>此攤位尚無平台 LINE Pay 交易。</p>:<ul className="space-y-3">{payments.map(payment=>{
      const balance=payment.amount-payment.refundedAmount-payment.pendingRefundAmount;
      const refundable=["PAID","PARTIALLY_REFUNDED"].includes(payment.paymentStatus)&&balance>0&&payment.pendingRefundAmount===0;
      return <li key={payment.attemptId} className="space-y-2 rounded-lg border p-3">
        <p className="font-semibold">訂單 {payment.orderNo} · NT$ {payment.amount}</p>
        <p className="text-sm">{payment.paymentStatus==="REFUNDED"?"已全額退款":payment.paymentStatus==="PARTIALLY_REFUNDED"?"已部分退款":stateLabels[payment.state]??"待查核"} · 已退 NT$ {payment.refundedAmount} · 待查核退款 NT$ {payment.pendingRefundAmount}</p>
        {payment.caseCount>0||payment.manualReview?<p className="text-sm text-amber-800">待人工查核案件：{payment.caseCount}。請核對商家 LINE Pay 交易明細，查無紀錄不能直接視為未付款或未退款。</p>:null}
        {payment.cases?.map(item=><p className="text-sm text-amber-800" key={item.id}>案件 {item.id.slice(0,8)}：{caseLabels[item.reason]??"付款狀態需人工查核"}</p>)}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void operate(payment)} className="min-h-11 rounded border px-3">查核訂單 {payment.orderNo}</button>
          {refundable?<button type="button" disabled={busy} onClick={()=>selectRefund(payment)} className="min-h-11 rounded border px-3">退款訂單 {payment.orderNo}</button>:null}</div>
      </li>;
    })}</ul>}
    {selected&&loaded?<form className="space-y-3 rounded-lg border-2 border-amber-600 p-4" onSubmit={event=>{event.preventDefault();void operate(selected,true);}}>
      <h3 className="font-semibold">確認退款：{selected.orderNo}</h3><p>目前可退款 NT$ {remaining}。送出後依金流查核結果入帳。</p>
      <label className="block">退款原因<input className="mt-1 block min-h-11 w-full rounded border px-3" value={reason} minLength={3} maxLength={500} required onChange={event=>{setReason(event.target.value);setConfirmed(false);}}/></label>
      {selected.partialRefundEnabled?<label className="block">退款金額（留空為剩餘全額）<input type="number" min={1} max={remaining} step={1} className="mt-1 block min-h-11 w-full rounded border px-3" value={amount} onChange={event=>{setAmount(event.target.value);setConfirmed(false);}}/></label>:null}
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我確認退款原因與 NT$ {requestedAmount} 金額</label>
      <div className="flex gap-2"><button type="submit" disabled={busy||!validRefund||!confirmed} className="min-h-11 rounded bg-teal-800 px-4 text-white disabled:opacity-50">{busy?"處理中…":"確認送出退款"}</button><button type="button" disabled={busy} onClick={()=>setSelected(null)} className="min-h-11 rounded border px-4">取消</button></div>
    </form>:null}
  </div>;
}
