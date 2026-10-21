"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
export function LinePlatformOrderRefresh({ active }: {active:boolean}) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  useEffect(()=>{
    if (!active) return;
    const refresh=()=>{if (document.visibilityState==="visible") startTransition(()=>router.refresh());};
    const timer=window.setInterval(refresh,15_000);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[active,router]);
  return <button type="button" className="min-h-11 rounded-lg border px-4" disabled={pending} onClick={()=>startTransition(()=>router.refresh())}>{pending?"更新中…":"更新訂單狀態"}</button>;
}
