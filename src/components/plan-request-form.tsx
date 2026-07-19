"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";

type Plan = {
  id: string;
  name: string;
  code: string;
  monthlyPrice: number;
  annualPrice: number | null;
  currency: string;
  includedOrders: number | null;
  includedStalls: number;
  maxStaff: number | null;
  maxProducts: number | null;
  features: string[];
};

export function PlanRequestForm({ organizationId, plans }: { organizationId: string; plans: Plan[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function requestPlan(plan: Plan, formData: FormData) {
    setSaving(plan.id);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/billing/plan-requests`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          planVersionId: plan.id,
          billingInterval: formData.get("billingInterval"),
          reason: formData.get("reason"),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法送出方案申請。");
      setMessage("方案申請已送出，平台管理員將建立人工付款帳單。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法送出方案申請。");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      {plans.map((plan) => (
        <article key={plan.id} className="rounded-md border border-stone-200 bg-white p-5">
          <h2 className="text-xl font-semibold">{plan.name}</h2>
          <p className="mt-2 text-2xl font-semibold">{formatMoney(plan.monthlyPrice, plan.currency)}<span className="text-sm font-normal text-stone-500"> / 月</span></p>
          <dl className="mt-4 space-y-2 text-sm text-stone-700">
            <div className="flex justify-between gap-3"><dt>包含訂單</dt><dd>{plan.includedOrders ?? "依合約"}</dd></div>
            <div className="flex justify-between gap-3"><dt>包含攤位</dt><dd>{plan.includedStalls}</dd></div>
            <div className="flex justify-between gap-3"><dt>員工上限</dt><dd>{plan.maxStaff ?? "依合約"}</dd></div>
            <div className="flex justify-between gap-3"><dt>商品上限</dt><dd>{plan.maxProducts ?? "依合約"}</dd></div>
          </dl>
          <details className="mt-4 border-y border-stone-200 py-2 text-sm">
            <summary className="cursor-pointer py-1 font-semibold">功能清單</summary>
            <ul className="mt-2 space-y-1 text-stone-600">{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          </details>
          <form action={(formData) => requestPlan(plan, formData)} className="mt-4 space-y-3">
            <label className="block text-sm font-medium">付款週期<select name="billingInterval" className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3"><option value="MONTHLY">月繳</option>{plan.annualPrice !== null ? <option value="ANNUAL">年繳 {formatMoney(plan.annualPrice, plan.currency)}</option> : null}</select></label>
            <label className="block text-sm font-medium">申請原因<input name="reason" required minLength={2} maxLength={500} defaultValue="申請升級營運方案" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label>
            <button type="submit" disabled={saving !== null} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" />{saving === plan.id ? "送出中..." : "申請此方案"}</button>
          </form>
        </article>
      ))}
      {message ? <p role="status" className="lg:col-span-3 border-y border-stone-200 py-3 text-sm font-medium">{message}</p> : null}
    </div>
  );
}
