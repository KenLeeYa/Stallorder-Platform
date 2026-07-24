"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, FilePlus2, PackagePlus, RotateCcw, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";

type PlanOption = {
  id: string;
  label: string;
  monthlyPrice: number;
  annualPrice: number | null;
  currency: string;
};

export function AdminInvoiceCreateForm({ organizationId, plans, request }: {
  organizationId: string;
  plans: PlanOption[];
  request?: { id: string; planVersionId: string; billingInterval: "MONTHLY" | "ANNUAL" };
}) {
  const router = useRouter();
  const initialPlanId = request?.planVersionId ?? plans[0]?.id ?? "";
  const [planId, setPlanId] = useState(initialPlanId);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedPlan = plans.find((plan) => plan.id === planId);

  async function submit(formData: FormData) {
    setSaving(true);
    setMessage("");
    try {
      const payload = await requestJson("/api/admin/billing/invoices", {
        method: "POST",
        body: {
          organizationId,
          planVersionId: planId,
          billingInterval: request?.billingInterval ?? formData.get("billingInterval"),
          dueAt: new Date(String(formData.get("dueAt"))).toISOString(),
          requestId: request?.id,
        },
      });
      setMessage(`帳單 ${payload.invoice.invoiceNumber} 已建立。`);
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, "目前無法建立帳單。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">方案版本
        <select value={planId} onChange={(event) => setPlanId(event.target.value)} disabled={Boolean(request)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">付款週期
        <select name="billingInterval" disabled={Boolean(request)} defaultValue={request?.billingInterval ?? "MONTHLY"} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
          <option value="MONTHLY">月繳 {selectedPlan ? formatMoney(selectedPlan.monthlyPrice, selectedPlan.currency) : ""}</option>
          {selectedPlan?.annualPrice !== null ? <option value="ANNUAL">年繳 {selectedPlan ? formatMoney(selectedPlan.annualPrice ?? 0, selectedPlan.currency) : ""}</option> : null}
        </select>
      </label>
      <label className="text-sm font-medium">付款期限<input name="dueAt" type="datetime-local" defaultValue={futureLocalDateTime(7)} required className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
      <button type="submit" disabled={saving || !planId} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><FilePlus2 className="h-4 w-4" />{saving ? "建立中..." : "建立人工帳單"}</button>
      {message ? <p role="status" className="border-y border-stone-200 py-3 text-sm font-medium sm:col-span-2">{message}</p> : null}
    </form>
  );
}

export function AdminPaymentReviewActions({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("已核對付款資料與帳單金額");
  const [saving, setSaving] = useState<"VERIFY" | "REJECT" | null>(null);
  const [message, setMessage] = useState("");

  async function decide(operation: "VERIFY" | "REJECT") {
    setSaving(operation);
    setMessage("");
    try {
      await requestJson(`/api/admin/billing/payments/${paymentId}`, { method: "PATCH", body: { operation, note } });
      setMessage(operation === "VERIFY" ? "付款已確認。" : "付款資料已退回。");
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, "目前無法完成付款審核。"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">審核備註<textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={2} maxLength={1000} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 p-3" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => decide("VERIFY")} disabled={saving !== null || note.trim().length < 2} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{saving === "VERIFY" ? "確認中..." : "確認付款"}</button>
        <button type="button" onClick={() => decide("REJECT")} disabled={saving !== null || note.trim().length < 2} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50"><X className="h-4 w-4" />{saving === "REJECT" ? "退回中..." : "退回付款"}</button>
      </div>
      {message ? <p role="status" className="text-sm font-medium">{message}</p> : null}
    </div>
  );
}

export function AdminSubscriptionActions({ subscriptionId, status, orderPackages }: {
  subscriptionId: string;
  status: string;
  orderPackages: Array<{ code: string; name: string }>;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function operation(body: Record<string, unknown>) {
    setSaving(true);
    setMessage("");
    try {
      await requestJson(`/api/admin/billing/subscriptions/${subscriptionId}`, { method: "PATCH", body });
      setMessage("訂閱資料已更新。")
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, "目前無法更新訂閱。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="border-y border-stone-200 py-4">
        <h3 className="font-semibold">狀態操作</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {status !== "SUSPENDED" ? <button type="button" disabled={saving} onClick={() => operation({ operation: "SUSPEND", reason: "平台管理員人工停權" })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800"><Ban className="h-4 w-4" />停權</button> : null}
          {status === "SUSPENDED" ? <button type="button" disabled={saving} onClick={() => operation({ operation: "REACTIVATE", reason: "平台管理員確認恢復服務" })} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white"><RotateCcw className="h-4 w-4" />恢復訂閱</button> : null}
          {status !== "ACTIVE" && status !== "SUSPENDED" ? <button type="button" disabled={saving} onClick={() => operation({ operation: "ACTIVATE", reason: "平台管理員人工啟用" })} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white"><Check className="h-4 w-4" />啟用</button> : null}
        </div>
      </section>
      {status === "TRIALING" || status === "SUSPENDED" ? <form action={(formData) => operation({ operation: "EXTEND_TRIAL", days: Number(formData.get("days")), reason: formData.get("reason") })} className="grid gap-3 sm:grid-cols-[120px_1fr_auto] sm:items-end"><label className="text-sm font-medium">延長天數<input name="days" type="number" min="1" max="90" defaultValue="7" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">原因<input type="text" name="reason" minLength={2} maxLength={500} defaultValue="人工延長試用期" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md border border-stone-300 px-4 text-sm font-semibold">延長試用</button></form> : null}
      <form action={(formData) => operation({ operation: "ASSIGN_ORDER_PACKAGE", code: formData.get("code"), quantity: Number(formData.get("quantity")), reason: formData.get("reason") })} className="grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-2">
        <label className="text-sm font-medium">訂單包<select name="code" className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">{orderPackages.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label className="text-sm font-medium">數量<input name="quantity" type="number" min="1" max="100" defaultValue="1" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label>
        <label className="text-sm font-medium sm:col-span-2">原因<input type="text" name="reason" minLength={2} maxLength={500} defaultValue="人工指派訂單包" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label>
        <button type="submit" disabled={saving || orderPackages.length === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"><PackagePlus className="h-4 w-4" />指派並加入帳單</button>
      </form>
      <form action={(formData) => operation({ operation: "REBUILD_USAGE", billingPeriod: `${formData.get("billingPeriod")}-01`, reason: formData.get("reason") })} className="grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-[180px_1fr_auto] sm:items-end"><label className="text-sm font-medium">計費月份<input name="billingPeriod" type="month" defaultValue={currentMonth()} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">原因<input type="text" name="reason" minLength={2} maxLength={500} defaultValue="人工用量對帳" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md border border-stone-300 px-4 text-sm font-semibold">重建用量</button></form>
      {message ? <p role="status" className="border-y border-stone-200 py-3 text-sm font-medium">{message}</p> : null}
    </div>
  );
}

export function AdditionalStallApprovalAction({ organizationId, requestId, quantity, unitPrice }: { organizationId: string; requestId: string; quantity: number; unitPrice: number | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(formData: FormData) {
    setSaving(true);
    setMessage("");
    try {
      await requestJson(`/api/admin/organizations/${organizationId}/additional-stalls`, { method: "POST", body: { changeRequestId: requestId, quantity, unitPrice: unitPrice ?? Number(formData.get("unitPrice")), reason: formData.get("reason") } });
      setMessage("額外攤位已核准並加入帳單。")
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, "目前無法核准額外攤位。"));
    } finally {
      setSaving(false);
    }
  }
  return <form action={submit} className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end"><label className="text-sm font-medium">單價<input name="unitPrice" type="number" min="0" max="100000000" defaultValue={unitPrice ?? ""} disabled={unitPrice !== null} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">核准原因<input type="text" name="reason" minLength={2} maxLength={500} defaultValue="已確認方案與攤位需求" required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "核准中..." : `核准 ${quantity} 個`}</button>{message ? <p role="status" className="text-sm font-medium sm:col-span-3">{message}</p> : null}</form>;
}

export function BillingRequestRejectAction({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("申請內容或時程需要重新確認");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function reject() {
    if (!confirming) { setConfirming(true); return; }
    setSaving(true);
    try {
      await requestJson(`/api/admin/billing/requests/${requestId}`, { method: "PATCH", body: { operation: "REJECT", note } });
      setMessage("申請已退回。")
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, "目前無法退回申請。"));
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }
  return <div className="mt-3 border-t border-stone-200 pt-3"><label className="block text-sm font-medium">退回原因<input type="text" value={note} onChange={(event) => setNote(event.target.value)} minLength={2} maxLength={500} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="button" onClick={reject} disabled={saving || note.trim().length < 2} className="mt-2 min-h-10 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">{confirming ? "再次點擊確認退回" : "退回申請"}</button>{message ? <p role="status" className="mt-2 text-sm font-medium">{message}</p> : null}</div>;
}

export function AdminInvoiceLineForm({ invoiceId, addOns }: { invoiceId: string; addOns: Array<{ code: string; name: string; price: number; currency: string }> }) {
  const router = useRouter();
  const [itemType, setItemType] = useState<"ADD_ON" | "CUSTOM_SERVICE" | "CREDIT" | "DISCOUNT">("CUSTOM_SERVICE");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedAddOn = useMemo(() => addOns[0], [addOns]);
  async function submit(formData: FormData) {
    setSaving(true);
    setMessage("");
    try {
      const body = itemType === "ADD_ON"
        ? { itemType, code: formData.get("addOnCode"), quantity: Number(formData.get("quantity")), reason: formData.get("reason") }
        : { itemType, code: String(formData.get("code") ?? "").toUpperCase(), description: formData.get("description"), quantity: Number(formData.get("quantity")), unitPrice: Number(formData.get("unitPrice")), reason: formData.get("reason") };
      await requestJson(`/api/admin/billing/invoices/${invoiceId}`, { method: "POST", body });
      setMessage("帳單項目已加入。")
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, "目前無法加入帳單項目。"));
    } finally {
      setSaving(false);
    }
  }
  return <form action={submit} className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">項目類型<select value={itemType} onChange={(event) => setItemType(event.target.value as typeof itemType)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3"><option value="CUSTOM_SERVICE">客製服務</option><option value="ADD_ON">加購功能</option><option value="CREDIT">折抵</option><option value="DISCOUNT">折扣</option></select></label>{itemType === "ADD_ON" ? <label className="text-sm font-medium">加購項目<select name="addOnCode" className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">{addOns.map((item) => <option key={item.code} value={item.code}>{item.name} {formatMoney(item.price, item.currency)}</option>)}</select></label> : <><label className="text-sm font-medium">代碼<input type="text" name="code" defaultValue={itemType} pattern="[A-Z][A-Z0-9_]{1,79}" minLength={2} maxLength={80} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 uppercase" /></label><label className="text-sm font-medium">說明<input type="text" name="description" minLength={2} maxLength={300} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">單價<input name="unitPrice" type="number" min="0" max="100000000" required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label></>}<label className="text-sm font-medium">數量<input name="quantity" type="number" min="1" max="100" defaultValue="1" required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">原因<input type="text" name="reason" minLength={2} maxLength={500} defaultValue="平台人工帳務調整" required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving || (itemType === "ADD_ON" && !selectedAddOn)} className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? "加入中..." : "加入帳單"}</button>{message ? <p role="status" className="text-sm font-medium sm:col-span-2">{message}</p> : null}</form>;
}

export function AdminInvoiceVoidAction({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  async function voidInvoice(formData: FormData) {
    if (!confirming) { setConfirming(true); return; }
    setSaving(true);
    try {
      await requestJson(`/api/admin/billing/invoices/${invoiceId}`, { method: "PATCH", body: { operation: "VOID", reason: formData.get("reason") } });
      setMessage("帳單已作廢。")
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, "目前無法作廢帳單。"));
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }
  return <form action={voidInvoice} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="text-sm font-medium">作廢原因<input type="text" name="reason" minLength={2} maxLength={500} defaultValue="帳務內容需重新建立" required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800">{confirming ? "再次點擊確認作廢" : "作廢帳單"}</button>{message ? <p role="status" className="text-sm font-medium sm:col-span-2">{message}</p> : null}</form>;
}

async function requestJson(url: string, input: { method: "POST" | "PATCH"; body: unknown }) {
  const response = await fetch(url, { method: input.method, headers: csrfHeaders(), body: JSON.stringify(input.body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "操作失敗，請稍後再試。");
  return payload;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function futureLocalDateTime(days: number) {
  const value = new Date(Date.now() + days * 86_400_000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function currentMonth() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}
