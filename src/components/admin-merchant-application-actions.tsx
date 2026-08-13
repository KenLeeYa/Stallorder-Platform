"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfHeaders } from "@/lib/csrf-client";
import { getAdminApiError, type AdminMessageKey } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

type Reviewer = { id: string; displayName: string; email: string | null };

export function AdminMerchantApplicationActions({ applicationId, status, reviewers }: { applicationId: string; status: string; reviewers: Reviewer[] }) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [riskLevel, setRiskLevel] = useState("HIGH");
  const isTerminal = ["APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"].includes(status);

  async function run(command: Record<string, unknown>, success: AdminMessageKey) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/merchant-applications/${applicationId}`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify(command) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(getAdminApiError(locale, result)); return; }
      setNotice(m(success)); setNote(""); router.refresh();
    } catch { setError(m("Unable to connect. Try again later.")); }
    finally { setBusy(false); }
  }

  return <section className="space-y-4">
    {error ? <p role="alert" className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p> : null}
    {notice ? <p role="status" className="border-l-4 border-teal-600 bg-teal-50 px-4 py-3 text-sm text-teal-900">{notice}</p> : null}
    {status === "WITHDRAWN" ? <section className="border-l-4 border-stone-500 bg-stone-50 px-4 py-3"><h3 className="font-semibold text-stone-900">{m("This case is closed")}</h3><p className="mt-1 text-sm text-stone-700">{m("A withdrawn case is not reopened. The applicant can create a new application from prior data; follow its new number in application history. This case remains for internal records and risk control.")}</p></section> : null}
    <details className="border-y border-stone-200 py-4" open><summary className="cursor-pointer font-semibold">{m(isTerminal ? "Internal record" : "Assignment and internal record")}</summary>{!isTerminal ? <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} className="min-h-11 border border-stone-300 bg-white px-3">{reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName} · {reviewer.email}</option>)}</select><button type="button" disabled={busy || !reviewerId} onClick={() => void run({ action: "ASSIGN_REVIEWER", reviewerProfileId: reviewerId }, "Reviewer updated.")} className="min-h-11 bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{m("Assign reviewer")}</button></div> : null}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={2000} placeholder={m("Internal review note, hidden from the applicant")} className="mt-3 w-full border border-stone-300 p-3 text-sm" /><button type="button" disabled={busy || note.trim().length < 3} onClick={() => void run({ action: "ADD_INTERNAL_NOTE", internalReviewNote: note }, "Internal note saved.")} className="mt-2 min-h-11 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{m("Save internal note")}</button></details>
    {status === "PENDING_REVIEW" ? <details className="border-b border-stone-200 pb-4"><summary className="cursor-pointer font-semibold">{m("Request information or approve")}</summary><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={1000} placeholder={m("This note is shown to the applicant when requesting information")} className="mt-4 w-full border border-stone-300 p-3 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || note.trim().length < 3} onClick={() => void run({ action: "REQUEST_INFO", publicReviewNote: note }, "Information requested from applicant.")} className="min-h-11 border border-amber-400 px-4 text-sm font-semibold text-amber-900 disabled:opacity-50">{m("Request information")}</button><button type="button" disabled={busy} onClick={() => { if (window.confirm(m("Approval creates a Trial workspace while QR and the stall remain disabled. Approve?"))) void run({ action: "APPROVE", internalReviewNote: note.trim() || null }, "Application approved and controlled Trial created."); }} className="min-h-11 bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{m("Approve and create Trial")}</button></div></details> : null}
    {status === "PENDING_REVIEW" ? <details className="border-b border-stone-200 pb-4"><summary className="cursor-pointer font-semibold text-red-800">{m("Reject or close application")}</summary><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={1000} placeholder={m("The rejection reason is shown to the applicant")} className="mt-4 w-full border border-stone-300 p-3 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || note.trim().length < 3} onClick={() => { if (window.confirm(m("Reject this application?"))) void run({ action: "REJECT", publicReviewNote: note, reapplicationAllowed: false }, "Application rejected."); }} className="min-h-11 bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{m("Reject application")}</button><button type="button" disabled={busy} onClick={() => { if (window.confirm(m("Close this application as the platform?"))) void run({ action: "WITHDRAW", internalReviewNote: note.trim() || null }, "Application closed."); }} className="min-h-11 border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">{m("Platform withdrawal")}</button></div></details> : null}
    <details className="border-b border-stone-200 pb-4"><summary className="cursor-pointer font-semibold">{m("Risk and source control")}</summary><div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]"><select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)} className="min-h-11 border border-stone-300 bg-white px-3">{["LOW", "MEDIUM", "HIGH", "BLOCKED"].map((risk) => <option key={risk} value={risk}>{m(risk === "LOW" ? "Low" : risk === "MEDIUM" ? "Medium" : risk === "HIGH" ? "High" : "Blocked")}</option>)}</select><input type="text" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={m("Risk assessment reason (internal)")} className="min-h-11 border border-stone-300 px-3" /></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || note.trim().length < 3} onClick={() => void run({ action: "MARK_RISK", riskLevel, reason: note }, "Risk status updated.")} className="min-h-11 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{m("Update risk")}</button><button type="button" disabled={busy || note.trim().length < 3} onClick={() => { if (window.confirm(m("Blocking prevents the same IP hash or session source from applying again. Continue?"))) void run({ action: "BLOCK_SOURCE", reason: note }, "Application source blocked."); }} className="min-h-11 border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">{m("Block application source")}</button></div></details>
    {status === "REJECTED" ? <button type="button" disabled={busy} onClick={() => void run({ action: "ALLOW_REAPPLICATION" }, "Reapplication allowed.")} className="min-h-11 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{m("Allow reapplication")}</button> : null}
  </section>;
}
