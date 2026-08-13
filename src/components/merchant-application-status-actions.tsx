"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleX } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { csrfHeaders } from "@/lib/csrf-client";
import { onboardingStatusMessages } from "@/lib/messages/onboarding-status";

export function MerchantApplicationWithdrawAction({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const { locale } = useAppLocale();
  const t = (key: Parameters<typeof onboardingStatusMessages.get>[1]) => onboardingStatusMessages.get(locale, key);
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
      await response.json();
      if (!response.ok) {
        setError(t("withdrawError"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) return <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center gap-2 border border-red-300 px-4 text-sm font-semibold text-red-800"><CircleX className="h-4 w-4" />{t("withdraw")}</button>;
  return <div className="border border-red-200 bg-red-50 p-4"><p className="text-sm text-red-950">{t("withdrawPrompt")}</p>{error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}<div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => void withdraw()} className="min-h-10 bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{t("confirmWithdraw")}</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-10 border border-stone-300 px-4 text-sm font-semibold">{t("keepApplication")}</button></div></div>;
}
