"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";

export function ManualPaymentForm({ organizationId, invoiceId, amountDue, currency }: {
  organizationId: string;
  invoiceId: string;
  amountDue: number;
  currency: string;
}) {
  const router = useRouter();
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(formData: FormData) {
    setSaving(true);
    setMessage("");
    try {
      const headers = { ...csrfHeaders(), "x-idempotency-key": idempotencyKey };
      const response = await fetch(`/api/merchant/organizations/${organizationId}/billing/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          invoiceId,
          paymentMethod: method,
          amount: Number(formData.get("amount")),
          referenceNumber: String(formData.get("referenceNumber") ?? "") || undefined,
          bankLastFive: method === "BANK_TRANSFER" ? String(formData.get("bankLastFive") ?? "") || undefined : undefined,
          receivedAt: new Date(String(formData.get("receivedAt"))).toISOString(),
          note: String(formData.get("note") ?? "") || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法送出付款資料。");
      setMessage("付款資料已送出，等待平台管理員確認。");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法送出付款資料。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-stone-200 pt-6">
      <h2 className="flex items-center gap-2 text-xl font-semibold"><Banknote className="h-5 w-5 text-teal-700" />提交人工付款</h2>
      <p className="mt-2 text-sm text-stone-600">未付金額 {formatMoney(amountDue, currency)}。平台確認前不會啟用或續訂服務。</p>
      <form action={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">付款方式<select value={method} onChange={(event) => setMethod(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3"><option value="BANK_TRANSFER">銀行轉帳</option><option value="CASH">現金</option><option value="LINE_PAY_MANUAL">LINE Pay 人工紀錄</option><option value="OTHER">其他</option></select></label>
        <label className="text-sm font-medium">付款金額<input name="amount" type="number" min="1" max={amountDue} defaultValue={amountDue} required className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
        <label className="text-sm font-medium">付款時間<input name="receivedAt" type="datetime-local" required defaultValue={localDateTime()} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
        <label className="text-sm font-medium">付款參考編號<input type="text" name="referenceNumber" maxLength={120} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
        {method === "BANK_TRANSFER" ? <label className="text-sm font-medium">轉出帳號末五碼<input type="text" name="bankLastFive" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label> : null}
        <label className="text-sm font-medium">備註<input type="text" name="note" maxLength={1000} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
        <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? "送出中..." : "送出付款資料"}</button>
      </form>
      {message ? <p role="status" className="mt-4 border-y border-stone-200 py-3 text-sm font-medium">{message}</p> : null}
    </section>
  );
}

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
