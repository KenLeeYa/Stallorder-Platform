"use client";
import Link from "next/link";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
export function LinePlatformGuestClaim({ trackingToken, member }: { trackingToken:string; member:boolean }) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function claim() {
    if (busy) return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/mini/orders/claim",{method:"POST",headers:csrfHeaders(),body:JSON.stringify({trackingToken})});
      if (!response.ok) throw new Error();
      const result=await response.json() as {href:string};
      if (!/^\/mini\/orders\/[0-9a-f-]{36}$/.test(result.href)) throw new Error();
      window.location.assign(result.href);
    } catch {setError("無法加入此訂單。請使用原下單裝置及本人 LINE；原訂單查詢仍可使用。");setBusy(false);}
  }
  return <section className="mt-5 space-y-3 rounded-xl border p-4"><h2 className="font-semibold">攤點通平台會員訂單</h2>
    {member ? <button type="button" className="min-h-11 rounded-lg bg-teal-700 px-4 text-white" disabled={busy} onClick={()=>void claim()}>{busy?"確認中…":"將本次訂單加入我的 LINE 會員"}</button>
      : <><Link href="/mini/member" className="inline-flex min-h-11 items-center underline">使用 LINE 登入並加入平台會員</Link><p>完成後，返回此訂單頁確認歸戶。請使用原本下單的瀏覽器。</p></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
