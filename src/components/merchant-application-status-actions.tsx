"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleX } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

export function MerchantApplicationWithdrawAction({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ intent: "WITHDRAW", applicationId }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "目前無法撤回申請。");
        return;
      }
      router.refresh();
    } catch {
      setError("目前無法連線，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) return <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center gap-2 border border-red-300 px-4 text-sm font-semibold text-red-800"><CircleX className="h-4 w-4" />撤回申請</button>;
  return <div className="border border-red-200 bg-red-50 p-4"><p className="text-sm text-red-950">撤回後本次申請將結束，確定要撤回嗎？</p>{error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}<div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => void withdraw()} className="min-h-10 bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">確認撤回</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-10 border border-stone-300 px-4 text-sm font-semibold">保留申請</button></div></div>;
}
