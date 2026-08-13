"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, FilePlus2, PackagePlus, RotateCcw, X } from "lucide-react";
import type { AppLocale } from "@/lib/app-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppCurrency } from "@/lib/locale-format";
import { getAdminApiError } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

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
  const { locale, m } = useAdminLocale();
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
      const payload = await requestJson(locale, "/api/admin/billing/invoices", {
        method: "POST",
        body: {
          organizationId,
          planVersionId: planId,
          billingInterval: request?.billingInterval ?? formData.get("billingInterval"),
          dueAt: new Date(String(formData.get("dueAt"))).toISOString(),
          requestId: request?.id,
        },
      });
      setMessage(m("Invoice {number} was created.", { number: payload.invoice.invoiceNumber }));
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, m("Operation failed. Try again later.")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">{m("Plan version")}
        <select value={planId} onChange={(event) => setPlanId(event.target.value)} disabled={Boolean(request)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">{m("Billing interval")}
        <select name="billingInterval" disabled={Boolean(request)} defaultValue={request?.billingInterval ?? "MONTHLY"} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
          <option value="MONTHLY">{m("Monthly {amount}", { amount: selectedPlan ? formatAppCurrency(locale, selectedPlan.monthlyPrice, selectedPlan.currency) : "" })}</option>
          {selectedPlan?.annualPrice !== null ? <option value="ANNUAL">{m("Annual {amount}", { amount: selectedPlan ? formatAppCurrency(locale, selectedPlan.annualPrice ?? 0, selectedPlan.currency) : "" })}</option> : null}
        </select>
      </label>
      <label className="text-sm font-medium">{m("Payment deadline")}<input name="dueAt" type="datetime-local" defaultValue={futureLocalDateTime(7)} required className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
      <button type="submit" disabled={saving || !planId} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><FilePlus2 className="h-4 w-4" />{m(saving ? "Creating..." : "Create manual invoice")}</button>
      {message ? <p role="status" className="border-y border-stone-200 py-3 text-sm font-medium sm:col-span-2">{message}</p> : null}
    </form>
  );
}

export function AdminPaymentReviewActions({ paymentId }: { paymentId: string }) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [note, setNote] = useState(() => m("Payment details and invoice amount verified"));
  const [saving, setSaving] = useState<"VERIFY" | "REJECT" | null>(null);
  const [message, setMessage] = useState("");

  async function decide(operation: "VERIFY" | "REJECT") {
    setSaving(operation);
    setMessage("");
    try {
      await requestJson(locale, `/api/admin/billing/payments/${paymentId}`, { method: "PATCH", body: { operation, note } });
      setMessage(m(operation === "VERIFY" ? "Payment confirmed." : "Payment information returned."));
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, m("Operation failed. Try again later.")));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">{m("Review note")}<textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={2} maxLength={1000} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 p-3" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => decide("VERIFY")} disabled={saving !== null || note.trim().length < 2} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{m(saving === "VERIFY" ? "Confirming..." : "Confirm payment")}</button>
        <button type="button" onClick={() => decide("REJECT")} disabled={saving !== null || note.trim().length < 2} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50"><X className="h-4 w-4" />{m(saving === "REJECT" ? "Returning..." : "Return payment")}</button>
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
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function operation(body: Record<string, unknown>) {
    setSaving(true);
    setMessage("");
    try {
      await requestJson(locale, `/api/admin/billing/subscriptions/${subscriptionId}`, { method: "PATCH", body });
      setMessage(m("Subscription updated."));
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, m("Operation failed. Try again later.")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="border-y border-stone-200 py-4">
        <h3 className="font-semibold">{m("Status actions")}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {status !== "SUSPENDED" ? <button type="button" disabled={saving} onClick={() => operation({ operation: "SUSPEND", reason: "Platform administrator manual suspension" })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800"><Ban className="h-4 w-4" />{m("Suspend")}</button> : null}
          {status === "SUSPENDED" ? <button type="button" disabled={saving} onClick={() => operation({ operation: "REACTIVATE", reason: "Platform administrator restored service" })} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white"><RotateCcw className="h-4 w-4" />{m("Reactivate subscription")}</button> : null}
          {status !== "ACTIVE" && status !== "SUSPENDED" ? <button type="button" disabled={saving} onClick={() => operation({ operation: "ACTIVATE", reason: "Platform administrator manual activation" })} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white"><Check className="h-4 w-4" />{m("Enable")}</button> : null}
        </div>
      </section>
      {status === "TRIALING" || status === "SUSPENDED" ? <form action={(formData) => operation({ operation: "EXTEND_TRIAL", days: Number(formData.get("days")), reason: formData.get("reason") })} className="grid gap-3 sm:grid-cols-[120px_1fr_auto] sm:items-end"><label className="text-sm font-medium">{m("Extend days")}<input name="days" type="number" min="1" max="90" defaultValue="7" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">{m("Reason")}<input type="text" name="reason" minLength={2} maxLength={500} defaultValue={m("Manually extend trial")} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md border border-stone-300 px-4 text-sm font-semibold">{m("Extend trial")}</button></form> : null}
      <form action={(formData) => operation({ operation: "ASSIGN_ORDER_PACKAGE", code: formData.get("code"), quantity: Number(formData.get("quantity")), reason: formData.get("reason") })} className="grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-2">
        <label className="text-sm font-medium">{m("Order package")}<select name="code" className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">{orderPackages.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label className="text-sm font-medium">{m("Quantity")}<input name="quantity" type="number" min="1" max="100" defaultValue="1" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label>
        <label className="text-sm font-medium sm:col-span-2">{m("Reason")}<input type="text" name="reason" minLength={2} maxLength={500} defaultValue={m("Manually assign order package")} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label>
        <button type="submit" disabled={saving || orderPackages.length === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"><PackagePlus className="h-4 w-4" />{m("Assign and add to invoice")}</button>
      </form>
      <form action={(formData) => operation({ operation: "REBUILD_USAGE", billingPeriod: `${formData.get("billingPeriod")}-01`, reason: formData.get("reason") })} className="grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-[180px_1fr_auto] sm:items-end"><label className="text-sm font-medium">{m("Billing month")}<input name="billingPeriod" type="month" defaultValue={currentMonth()} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">{m("Reason")}<input type="text" name="reason" minLength={2} maxLength={500} defaultValue={m("Manual usage reconciliation")} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md border border-stone-300 px-4 text-sm font-semibold">{m("Rebuild usage")}</button></form>
      {message ? <p role="status" className="border-y border-stone-200 py-3 text-sm font-medium">{message}</p> : null}
    </div>
  );
}

export function AdditionalStallApprovalAction({ organizationId, requestId, quantity, unitPrice }: { organizationId: string; requestId: string; quantity: number; unitPrice: number | null }) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(formData: FormData) {
    setSaving(true);
    setMessage("");
    try {
      await requestJson(locale, `/api/admin/organizations/${organizationId}/additional-stalls`, { method: "POST", body: { changeRequestId: requestId, quantity, unitPrice: unitPrice ?? Number(formData.get("unitPrice")), reason: formData.get("reason") } });
      setMessage(m("Additional stalls approved and added to invoice."));
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, m("Operation failed. Try again later.")));
    } finally {
      setSaving(false);
    }
  }
  return <form action={submit} className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end"><label className="text-sm font-medium">{m("Unit price")}<input name="unitPrice" type="number" min="0" max="100000000" defaultValue={unitPrice ?? ""} disabled={unitPrice !== null} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">{m("Approval reason")}<input type="text" name="reason" minLength={2} maxLength={500} defaultValue={m("Plan and stall requirements confirmed")} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? m("Approving...") : m("Approve {count}", { count: quantity })}</button>{message ? <p role="status" className="text-sm font-medium sm:col-span-3">{message}</p> : null}</form>;
}

export function BillingRequestRejectAction({ requestId }: { requestId: string }) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [note, setNote] = useState(() => m("Application details or timing need reconfirmation"));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function reject() {
    if (!confirming) { setConfirming(true); return; }
    setSaving(true);
    try {
      await requestJson(locale, `/api/admin/billing/requests/${requestId}`, { method: "PATCH", body: { operation: "REJECT", note } });
      setMessage(m("Application returned."));
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, m("Operation failed. Try again later.")));
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }
  return <div className="mt-3 border-t border-stone-200 pt-3"><label className="block text-sm font-medium">{m("Return reason")}<input type="text" value={note} onChange={(event) => setNote(event.target.value)} minLength={2} maxLength={500} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="button" onClick={reject} disabled={saving || note.trim().length < 2} className="mt-2 min-h-10 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">{m(confirming ? "Click again to confirm return" : "Return application")}</button>{message ? <p role="status" className="mt-2 text-sm font-medium">{message}</p> : null}</div>;
}

export function AdminInvoiceLineForm({ invoiceId, addOns }: { invoiceId: string; addOns: Array<{ code: string; name: string; price: number; currency: string }> }) {
  const { locale, m } = useAdminLocale();
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
      await requestJson(locale, `/api/admin/billing/invoices/${invoiceId}`, { method: "POST", body });
      setMessage(m("Invoice item added."));
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, m("Operation failed. Try again later.")));
    } finally {
      setSaving(false);
    }
  }
  return <form action={submit} className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">{m("Item type")}<select value={itemType} onChange={(event) => setItemType(event.target.value as typeof itemType)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3"><option value="CUSTOM_SERVICE">{m("Custom service")}</option><option value="ADD_ON">{m("Add-on")}</option><option value="CREDIT">{m("Credit")}</option><option value="DISCOUNT">{m("Discount")}</option></select></label>{itemType === "ADD_ON" ? <label className="text-sm font-medium">{m("Add-on item")}<select name="addOnCode" className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">{addOns.map((item) => <option key={item.code} value={item.code}>{item.name} {formatAppCurrency(locale, item.price, item.currency)}</option>)}</select></label> : <><label className="text-sm font-medium">{m("Code")}<input type="text" name="code" defaultValue={itemType} pattern="[A-Z][A-Z0-9_]{1,79}" minLength={2} maxLength={80} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 uppercase" /></label><label className="text-sm font-medium">{m("Description")}<input type="text" name="description" minLength={2} maxLength={300} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">{m("Unit price")}<input name="unitPrice" type="number" min="0" max="100000000" required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label></>}<label className="text-sm font-medium">{m("Quantity")}<input name="quantity" type="number" min="1" max="100" defaultValue="1" required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">{m("Reason")}<input type="text" name="reason" minLength={2} maxLength={500} defaultValue={m("Manual platform billing adjustment")} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving || (itemType === "ADD_ON" && !selectedAddOn)} className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{m(saving ? "Adding..." : "Add to invoice")}</button>{message ? <p role="status" className="text-sm font-medium sm:col-span-2">{message}</p> : null}</form>;
}

export function AdminInvoiceVoidAction({ invoiceId }: { invoiceId: string }) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  async function voidInvoice(formData: FormData) {
    if (!confirming) { setConfirming(true); return; }
    setSaving(true);
    try {
      await requestJson(locale, `/api/admin/billing/invoices/${invoiceId}`, { method: "PATCH", body: { operation: "VOID", reason: formData.get("reason") } });
      setMessage(m("Invoice voided."));
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error, m("Operation failed. Try again later.")));
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }
  return <form action={voidInvoice} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="text-sm font-medium">{m("Void reason")}<input type="text" name="reason" minLength={2} maxLength={500} defaultValue={m("Billing details must be recreated")} required className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3" /></label><button type="submit" disabled={saving} className="min-h-10 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800">{m(confirming ? "Click again to confirm void" : "Void invoice")}</button>{message ? <p role="status" className="text-sm font-medium sm:col-span-2">{message}</p> : null}</form>;
}

async function requestJson(locale: AppLocale, url: string, input: { method: "POST" | "PATCH"; body: unknown }) {
  const response = await fetch(url, { method: input.method, headers: csrfHeaders(), body: JSON.stringify(input.body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminRequestError(getAdminApiError(locale, payload));
  return payload;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof AdminRequestError ? error.message : fallback;
}

class AdminRequestError extends Error {}

function futureLocalDateTime(days: number) {
  const value = new Date(Date.now() + days * 86_400_000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function currentMonth() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}
