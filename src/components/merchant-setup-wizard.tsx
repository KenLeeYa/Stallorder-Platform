"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Circle, ClipboardCheck, ExternalLink, Rocket, ShieldCheck } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

type SetupStepKey = "MERCHANT_PROFILE" | "STALL_PROFILE" | "CATALOG" | "PAYMENT_OPTIONS" | "TEAM" | "QR_PREVIEW";
type Step = { key: SetupStepKey; label: string; description: string; completed: boolean; href: string };

export function MerchantSetupWizard({
  organizationId,
  stall,
  qrCode,
  applicationNumber,
  subscription,
  steps,
  testOrder,
  goLiveCompleted,
  appBaseUrl,
}: {
  organizationId: string;
  stall: { id: string; name: string; slug: string; orderingState: string; orderingEnabled: boolean; businessStatus: string };
  qrCode: { token: string; tokenVersion: number; state: string };
  applicationNumber: string;
  subscription: { status: string; planName: string; trialEndsAt: string | null };
  steps: Step[];
  testOrder: { orderNo: string; status: string; isTest: boolean } | null;
  goLiveCompleted: boolean;
  appBaseUrl: string;
}) {
  const router = useRouter();
  const { locale, m, label } = useMerchantMessages();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const orderUrl = `${appBaseUrl.replace(/\/$/, "")}/q/${encodeURIComponent(qrCode.token)}`;
  const allStepsComplete = steps.every((step) => step.completed);
  const testOrderCompleted = testOrder?.isTest === true && testOrder.status === "COMPLETED";

  async function run(command: Record<string, unknown>, success: string) {
    setBusy(String(command.action)); setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/setup`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) { setMessage(typeof payload.error === "string" ? label(payload.error) : m("目前無法完成操作。")); return; }
      setMessage(success); router.refresh();
    } catch { setMessage(m("網路連線中斷，請稍後再試。")); }
    finally { setBusy(""); }
  }

  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
    <ContextualBackButton fallbackHref={`/merchant/stalls/${stall.id}`} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-800">
      {m("返回攤位設定")}
    </ContextualBackButton>
    <header className="border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{applicationNumber}</p><div className="mt-1 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-semibold">{m("開店設定")}</h1><p className="mt-2 text-sm text-stone-600">{stall.name} · {subscription.planName} · {label(subscription.status)}</p></div><div className="text-right text-sm"><p className="font-semibold">QR {label(qrCode.state)}</p><p className="mt-1 text-stone-500">{m("攤位 {state}", { state: label(stall.orderingState) })}</p></div></div></header>
    {message ? <p role="status" className="mt-5 border-l-4 border-teal-600 bg-teal-50 px-4 py-3 text-sm text-teal-950">{message}</p> : null}
    <section className="py-6"><h2 className="text-xl font-semibold">{m("設定清單")}</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{steps.map((step, index) => <article key={step.key} className="rounded-md border border-stone-200 bg-white p-4"><div className="flex items-start gap-3">{step.completed ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-stone-400" />}<div className="min-w-0 flex-1"><h3 className="font-semibold">{formatAppNumber(locale, index + 1)}. {step.label}</h3><p className="mt-1 text-sm text-stone-600">{step.description}</p><div className="mt-3 flex flex-wrap gap-2"><Link href={step.href} className="inline-flex min-h-10 items-center gap-1 border border-stone-300 px-3 text-xs font-semibold">{m("前往設定")}<ExternalLink className="h-3.5 w-3.5" /></Link>{!step.completed ? <button type="button" disabled={Boolean(busy)} onClick={() => void run({ action: "COMPLETE_STEP", step: step.key }, m("{label}已確認。", { label: step.label }))} className="min-h-10 bg-stone-900 px-3 text-xs font-semibold text-white disabled:opacity-50">{m("確認完成")}</button> : null}</div></div></div></article>)}</div></section>
    <section className="border-t border-stone-200 py-6"><div className="grid gap-6 md:grid-cols-[260px_1fr]"><div className="flex items-center justify-center rounded-md border border-stone-200 bg-white p-4"><QRCodeSVG value={orderUrl} size={220} level="M" className="h-auto w-full" /></div><div><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">{m("QR 預覽")}</h2></div><p className="mt-2 text-sm text-stone-600">{m("版本 {version} · {state}", { version: formatAppNumber(locale, qrCode.tokenVersion), state: label(qrCode.state) })}</p><p className="mt-1 break-all text-xs text-stone-500">{orderUrl}</p><p className="mt-4 text-sm font-medium text-amber-800">{m("完成正式開放前，掃描此 QR 不會接受顧客訂單。")}</p></div></div></section>
    <section className="border-t border-stone-200 py-6"><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">{m("7. 完成測試訂單")}</h2></div>{testOrder ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-stone-200 py-4"><div><strong>{m("測試訂單 {orderNo}", { orderNo: testOrder.orderNo })}</strong><p className="mt-1 text-sm text-stone-600">{m("狀態：{status}", { status: label(testOrder.status) })}</p></div><Link href={`/staff/${stall.slug}`} className="inline-flex min-h-11 items-center bg-teal-700 px-4 text-sm font-semibold text-white">{m("前往店員畫面處理")}</Link></div> : <button type="button" disabled={Boolean(busy) || !allStepsComplete} onClick={() => void run({ action: "CREATE_TEST_ORDER" }, m("測試訂單已建立，請前往店員畫面完成流程。")) } className="mt-4 min-h-11 bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-40">{m("建立測試訂單")}</button>} {!allStepsComplete ? <p className="mt-3 text-sm text-amber-800">{m("請先完成前六個設定步驟。")}</p> : null}</section>
    <section className="border-y border-stone-200 py-6"><div className="flex items-center gap-2"><Rocket className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">{m("8. 正式開放接單")}</h2></div>{goLiveCompleted ? <div className="mt-4"><p className="font-semibold text-teal-800">{m("QR 點餐已開放，攤位目前可接收正式訂單。")}</p><div className="mt-3 flex gap-2"><Link href={orderUrl} target="_blank" className="inline-flex min-h-11 items-center border border-stone-300 px-4 text-sm font-semibold">{m("開啟顧客點餐頁")}</Link><Link href={`/merchant/${stall.slug}`} className="inline-flex min-h-11 items-center bg-stone-900 px-4 text-sm font-semibold text-white">{m("管理攤位")}</Link></div></div> : <><p className="mt-3 text-sm text-stone-600">{m("只有完成測試訂單後，組織擁有者才能明確開放 QR 與攤位接單。")}</p><button type="button" disabled={Boolean(busy) || !testOrderCompleted} onClick={() => { if (window.confirm(m("確定正式開放 QR 點餐？QR 將變為 ACTIVE，攤位將開始接收顧客訂單。"))) void run({ action: "GO_LIVE" }, m("QR 點餐已正式開放。")); }} className="mt-4 min-h-11 bg-stone-950 px-5 text-sm font-semibold text-white disabled:opacity-40">{m("正式開放 QR 接單")}</button>{!testOrderCompleted ? <p className="mt-2 text-sm text-amber-800">{m("測試訂單尚未完成。")}</p> : null}</>}</section>
    <footer className="py-5 text-xs text-stone-500">{m("Trial 到期日：{date}", { date: subscription.trialEndsAt ? formatAppDate(locale, subscription.trialEndsAt) : m("依方案設定") })}</footer>
  </main>;
}
