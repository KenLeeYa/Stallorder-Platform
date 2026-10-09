"use client";
import { useEffect, useState } from "react";
import { initializeMiniAppEntry } from "@/lib/line-miniapp-entry";

export function LineMiniAppEntry({ liffId, children }: { liffId: string; children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void initializeMiniAppEntry(liffId, window.location.search).then(
      () => { if (active) setState("ready"); },
      () => { if (active) setState("error"); },
    );
    return () => { active = false; };
  }, [liffId, attempt]);
  if (state === "ready") return children;
  return <main className="fixed inset-0 z-[100] space-y-4 bg-stone-50 p-6 text-stone-950">
    {state === "error" ? <>
      <p role="alert">LINE 入口載入失敗，請重試。</p>
      <button type="button" className="min-h-12 rounded-lg bg-teal-800 px-4 py-3 font-semibold text-white"
        onClick={() => { setState("loading"); setAttempt(value => value + 1); }}>重新載入 LINE 入口</button>
    </> : <p role="status">正在開啟 LINE 點餐…</p>}
  </main>;
}
