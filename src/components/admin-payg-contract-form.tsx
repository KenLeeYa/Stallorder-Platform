"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfHeaders } from "@/lib/csrf-client";
import { getAdminApiError } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

export function AdminPaygContractForm({ sourceVersions }: {
  sourceVersions: Array<{ id: string; label: string }>;
}) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const taxTreatment = String(form.get("taxTreatment"));
    const taxable = taxTreatment === "INCLUSIVE" || taxTreatment === "EXCLUSIVE";
    if (!window.confirm(m("A sealed contract cannot be edited. Price, tax, timezone, or entitlement changes require another version. Continue?"))) return;
    setPending(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/billing/payg-plan-versions", {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          sourcePlanVersionId: form.get("sourcePlanVersionId"),
          taxTreatment,
          taxRateBps: taxable ? Number(form.get("taxRateBps")) : null,
          taxJurisdiction: form.get("taxJurisdiction"),
          taxRoundingMode: form.get("taxRoundingMode"),
          taxRoundingScope: form.get("taxRoundingScope"),
          capTaxBasis: taxable ? form.get("capTaxBasis") : null,
          taxDocumentRequired: form.get("taxDocumentRequired") === "on",
          billingTimezone: form.get("billingTimezone"),
          invoiceCloseDelayHours: Number(form.get("invoiceCloseDelayHours")),
          reason: form.get("reason"),
          confirmation: "CREATE_AND_SEAL_PAYG_VERSION",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getAdminApiError(locale, payload));
      setNotice(m("PAYG contract version created and sealed."));
      formElement.reset();
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : m("Operation failed. Try again later."));
    } finally {
      setPending(false);
    }
  }

  if (sourceVersions.length === 0) return null;
  return (
    <section className="mt-7 border-y border-stone-200 py-6">
      <h2 className="text-xl font-semibold">{m("Create and seal a PAYG contract version")}</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">{m("Only use an approved finance and tax decision. Existing subscriptions are not migrated automatically, and all charging flags remain unchanged.")}</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={m("Source plan version")}><select name="sourcePlanVersionId" required className="form-input">{sourceVersions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}</select></Field>
        <Field label={m("Tax treatment")}><select name="taxTreatment" required className="form-input"><option value="">—</option><option value="INCLUSIVE">INCLUSIVE</option><option value="EXCLUSIVE">EXCLUSIVE</option><option value="EXEMPT">EXEMPT</option><option value="OUT_OF_SCOPE">OUT_OF_SCOPE</option></select></Field>
        <Field label={m("Tax rate (basis points)")}><input name="taxRateBps" type="number" min="0" max="10000" className="form-input" /></Field>
        <Field label={m("Tax jurisdiction")}><input name="taxJurisdiction" type="text" required maxLength={80} className="form-input" placeholder="TW" /></Field>
        <Field label={m("Tax rounding mode")}><select name="taxRoundingMode" defaultValue="HALF_UP" className="form-input"><option>HALF_UP</option><option>HALF_EVEN</option><option>FLOOR</option><option>CEILING</option></select></Field>
        <Field label={m("Tax rounding scope")}><select name="taxRoundingScope" defaultValue="INVOICE" className="form-input"><option>INVOICE</option><option>STALL_LINE</option></select></Field>
        <Field label={m("Cap tax basis")}><select name="capTaxBasis" defaultValue="" className="form-input"><option value="">—</option><option>TAX_INCLUSIVE_TOTAL</option><option>PRE_TAX_USAGE</option></select></Field>
        <Field label={m("Billing timezone")}><input name="billingTimezone" type="text" required defaultValue="Asia/Taipei" maxLength={100} className="form-input" /></Field>
        <Field label={m("Automatic close delay (hours)")}><input name="invoiceCloseDelayHours" type="number" required min="0" max="744" className="form-input" /></Field>
        <label className="flex min-h-11 items-center gap-3 rounded-md border border-stone-200 px-3 text-sm font-semibold"><input name="taxDocumentRequired" type="checkbox" />{m("Tax document required")}</label>
        <Field label={m("Approval reason")} className="sm:col-span-2"><textarea name="reason" required minLength={5} maxLength={500} className="form-input min-h-24" /></Field>
        <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-teal-800 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2">{pending ? "…" : m("Create and seal")}</button>
      </form>
      {notice ? <p role="status" className="mt-4 text-sm font-semibold text-stone-700">{notice}</p> : null}
    </section>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1.5 text-sm font-semibold ${className}`}><span>{label}</span>{children}</label>;
}
