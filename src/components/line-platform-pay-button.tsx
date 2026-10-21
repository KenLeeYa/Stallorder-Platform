"use client";
import { useEffect,useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
type Payment = { attemptId: string; state: string; paymentStatus: string; paymentUrl?: string | null; refundUnknown: boolean; pendingRefundAmount: number };
const labels: Record<string,string>={ REQUESTING:"正在建立付款，請勿重複付款",PENDING_AUTH:"等待 LINE Pay 授權",CONFIRMING:"正在確認付款，請勿重複付款",UNKNOWN:"付款結果待查核，請勿再以其他方式付款",MANUAL_REVIEW:"付款需要店家協助查核",SUCCEEDED:"付款已確認",FAILED:"付款未成功",CANCELLED:"付款已取消或逾時" };
type Props = { orderId: string;amount: number;orderVersion: string;allowNewPayment: boolean };
export function LinePlatformPayButton(props: Props) { return <PaymentControls key={`${props.orderId}:${props.orderVersion}`} {...props}/>; }
function PaymentControls({ orderId,amount,orderVersion,allowNewPayment }: Props) {
  const [payment,setPayment]=useState<Payment|null>(null); const [loaded,setLoaded]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{ let active=true;
    fetch(`/api/payments/line-pay/order/${orderId}`,{ credentials:"same-origin",cache:"no-store" }).then(async response=>{
      if(!response.ok) throw new Error(); const result=await response.json(); if(active){setPayment(result.payment);setLoaded(true);}
    }).catch(()=>{if(active)setError("目前無法確認付款狀態，請稍後重新整理。");}); return()=>{active=false;};
  },[orderId]);
  const mayPay=allowNewPayment && loaded && (!payment || ["FAILED","CANCELLED"].includes(payment.state));
  async function act(start: boolean){
    if(busy || !loaded || (start && !allowNewPayment)) return; setBusy(true);setError("");
    try {
      const response=await fetch(start?"/api/payments/line-pay/checkout":`/api/payments/line-pay/${payment!.attemptId}`,{
        method:"POST",credentials:"same-origin",cache:"no-store",headers:{...csrfHeaders(),...(start?{"x-idempotency-key":crypto.randomUUID()}:{})},
        ...(start?{body:JSON.stringify({orderId,expectedAmount:amount,orderVersion})}:{}),
      });
      if(!response.ok) throw new Error(); const result=await response.json();setPayment(result.payment);
      if(start && result.payment.paymentUrl){
        const url=new URL(result.payment.paymentUrl);if(url.origin!=="https://sandbox-web-pay.line.me")throw new Error();
        window.location.assign(url.href);
      }
    }catch{setError("付款未完成或結果尚未確認。請查詢付款狀態，勿重複付款。");
      // Lost checkout responses can still represent an existing attempt. Reload its durable status.
      setLoaded(false);
      try {const response=await fetch(`/api/payments/line-pay/order/${orderId}`,{cache:"no-store"});if(response.ok){setPayment((await response.json()).payment);setLoaded(true);}}catch{ /* keep checkout disabled until durable status is known */ }
    }finally{setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="LINE Pay 付款">
    <p className="font-semibold">LINE Pay 測試付款</p>
    {payment?<p role="status">{payment.refundUnknown?"退款結果待查核，店家正在處理":payment.paymentStatus==="REFUNDED"?"已退款":labels[payment.state]??"請查詢付款狀態"}</p>:<p>本次付款 NT$ {amount}</p>}
    {mayPay?<button type="button" disabled={busy} onClick={()=>void act(true)} className="min-h-11 rounded-lg bg-teal-800 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?"處理中…":"前往 LINE Pay Sandbox"}</button>:null}
    {payment && !["SUCCEEDED","FAILED","CANCELLED"].includes(payment.state)?<button type="button" disabled={busy} onClick={()=>void act(false)} className="min-h-11 rounded-lg border px-4 py-3">{busy?"查詢中…":"查詢／恢復付款"}</button>:null}
    {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
  </section>;
}
