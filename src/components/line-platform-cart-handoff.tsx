"use client";
import { useEffect, useState } from 'react';
import type { QrCartDraft, QrCartOrderingMode } from '@/lib/qr-cart';
import { csrfHeaders } from '@/lib/csrf-client';
import { saveGuestCartHandoff,readGuestCartHandoff,clearGuestCartHandoff } from '@/lib/guest-cart-handoff';
export type CartHandoffProps={enabled:boolean;customerId?:string;qrToken:string;orderingMode:QrCartOrderingMode;orderSessionToken:string;deviceId:string;allowExport:boolean;allowImport:boolean;draft:Omit<QrCartDraft,'version'|'savedAt'>|null;onImport:(raw:string)=>void};
export function LinePlatformCartHandoff(props:CartHandoffProps){
  const [candidate,setCandidate]=useState<ReturnType<typeof readGuestCartHandoff>>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(!props.customerId)return;
    void Promise.resolve().then(()=>{try{setCandidate(readGuestCartHandoff(window.sessionStorage,props.qrToken,props.orderingMode));}catch{setCandidate(null);}});
  },[props.customerId,props.qrToken,props.orderingMode]);
  if(!props.enabled||!['PREORDER','DELIVERY'].includes(props.orderingMode))return null;
  const exporting=!props.customerId&&props.allowExport&&Boolean(props.draft?.lines.length);
  if(!exporting&&!candidate)return null;
  async function act(){
    if(busy)return;setBusy(true);setError('');
    try{
      if(exporting){
        const response=await fetch('/api/public/cart-handoff',{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json','x-stallorder-protocol-version':'1'},body:JSON.stringify({orderSessionToken:props.orderSessionToken,qrToken:props.qrToken,deviceId:props.deviceId,draft:props.draft})});
        if(!response.ok)throw new Error();const result=await response.json() as {sealedDraft:string;expiresAt:number;href:string};
        if(!saveGuestCartHandoff(window.sessionStorage,props.qrToken,props.orderingMode,{sealedDraft:result.sealedDraft,expiresAt:result.expiresAt}))throw new Error();
        const target=new URL(result.href,window.location.origin);if(target.origin!==window.location.origin||!target.pathname.startsWith('/mini/store/'))throw new Error();
        window.location.assign(target.href);
      }else if(candidate){
        const response=await fetch('/api/mini/cart-handoff',{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000),headers:csrfHeaders(),body:JSON.stringify({qrToken:props.qrToken,orderingMode:props.orderingMode,sealedDraft:candidate.sealedDraft})});
        if(!response.ok)throw new Error();const result=await response.json() as {draft:string};props.onImport(result.draft);
        clearGuestCartHandoff(window.sessionStorage,props.qrToken,props.orderingMode);setCandidate(null);
      }
    }catch{setError('購物車未轉移。請繼續目前的點餐，或重新建立訪客購物車後再試。');}
    finally{setBusy(false);}
  }
  return <section className="mt-3 rounded-lg border border-teal-300 bg-teal-50 p-3 text-sm text-teal-950">
    <p>{exporting?'可將這次新建的購物車帶入 LINE，同店商品與金額會重新驗證。':'找到剛才同店的訪客購物車。匯入會取代目前草稿，商品與金額會重新驗證。'}</p>
    <button type="button" className="mt-2 min-h-11 rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={busy||(!exporting&&!props.allowImport)} onClick={()=>void act()}>{busy?'處理中…':exporting?'用 LINE 繼續此購物車':'匯入剛才的訪客購物車'}</button>
    {error&&<p role="alert" className="mt-2">{error}</p>}
  </section>;
}
