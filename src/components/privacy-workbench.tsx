"use client";
import { useEffect, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { getPrivacyMessages } from "@/lib/messages/privacy";
import { canTransition, requestTransition } from "@/server/compliance/contracts";
import { governanceCommand, governedAction } from "@/server/compliance/governance-contracts";
import { getComplianceStepUp } from "@/lib/compliance-step-up-client";
import { PrivacyMfaSetup } from "@/components/privacy-mfa-setup";
type Row = { id: string; request_type: string; status: string; due_at: string; version: number };
export function PrivacyWorkbench({ organizationId, locale, mfaAvailable }: { organizationId: string; locale: string; mfaAvailable: boolean }) {
  const text = getPrivacyMessages(locale);
  const [rows, setRows] = useState<Row[]>([]); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ details?: string; mode?: string; planDigest?: string; id?: string; status?: string; dueAt?: string; targets?: { target: string; count: number | null; blocked: string | null }[] } | null>(null);
  const endpoint = `/api/merchant/organizations/${organizationId}/privacy`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}?page=${page}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); setRows((await response.json()).requests);
    }).catch(() => { if (!controller.signal.aborted) setError(text.unavailable); });
    return () => controller.abort();
  }, [endpoint, page, revision, text.unavailable]);
  async function update(event: React.FormEvent<HTMLFormElement>, row: Row) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const command = requestTransition.parse({ id: row.id, expectedVersion: row.version, status: form.get("status"), reason: form.get("reason") });
      const grant = command.status === "APPROVED" ? await getComplianceStepUp("PRIVACY_APPROVE", organizationId, command, code) : null;
      const response = await fetch(endpoint, { method: "PATCH", headers: { ...csrfHeaders(), ...(grant ? { "x-step-up-grant": grant } : {}) }, body: JSON.stringify(command) });
      if (!response.ok) throw new Error(); setRevision((value) => value + 1);
      setCode("");
    } catch { setError(text.unavailable); } finally { setBusy(false); }
  }
  async function run(input: unknown) {
    setBusy(true); setError(""); setResult(null);
    try {
      const command = governanceCommand.parse(input); const action = governedAction(command);
      const grant = action ? await getComplianceStepUp(action, organizationId, command, code) : null;
      const response = await fetch(endpoint, { method: "POST", headers: { ...csrfHeaders(), ...(grant ? { "x-step-up-grant": grant } : {}) }, body: JSON.stringify(command) });
      if (!response.ok) {
        const error = await response.json();
        if (error.code === "DELETION_DRY_RUN_ONLY") { setError(text.dryRunOnly); return; }
        throw new Error();
      }
      setResult(await response.json()); setRevision((value) => value + 1); setCode("");
    } catch { setError(text.operationFailed); } finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-3xl space-y-4 p-4"><h2 className="text-xl font-semibold">{text.workbench}</h2>
    {mfaAvailable ? <PrivacyMfaSetup locale={locale} /> : <p role="status">{text.mfaUnavailableNotice}</p>}
    {mfaAvailable && <label className="block">{text.sensitiveCode}<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="mt-1 min-h-11 w-full rounded border p-2" /></label>}
    {error && <p role="alert">{error}</p>}{rows.length === 0 && <p>{text.empty}</p>}
    {result && <div role="status" className="space-y-2 rounded border p-3 break-words">
      <p>{result.mode === "DRY_RUN" ? text.previewDone : text.recorded}</p>
      {result.details && <p className="whitespace-pre-wrap">{result.details}</p>}
      {result.id && <p>{text.recordId}: {result.id}</p>}
      {result.dueAt && <p>{text.due}: {new Date(result.dueAt).toLocaleString(locale)}</p>}
      {result.planDigest && <p>{text.planDigest}: {result.planDigest}</p>}
      {result.targets && <ul>{result.targets.map((target) => <li key={target.target}>{text.targets[target.target as keyof typeof text.targets] ?? target.target}: {target.count ?? text.inventoryPending}; {target.blocked ? text.blockedTarget : text.eligibleTarget}</li>)}</ul>}
    </div>}
    {rows.map((row) => <article key={row.id} className="space-y-3 rounded-xl border p-4 break-words"><p>{row.id}</p>
      <p>{text.types[row.request_type as keyof typeof text.types]} · {text.states[row.status as keyof typeof text.states]}</p><p>{text.due}: {new Date(row.due_at).toLocaleString(locale, { timeZone: "Asia/Taipei" })}</p>
      <div className="flex flex-wrap gap-2"><button disabled={busy || !mfaAvailable} className="min-h-11 rounded border px-3" onClick={() => run({ action: "DETAIL", id: row.id })}>{text.detail}</button>
        {["ACCESS", "COPY"].includes(row.request_type) && ["APPROVED", "EXECUTING"].includes(row.status) && <button disabled={busy || !mfaAvailable} className="min-h-11 rounded border px-3" onClick={() => run({ action: "EXPORT", id: row.id, expectedVersion: row.version })}>{text.prepareCopy}</button>}
        {row.request_type === "DELETE" && <button disabled={busy} className="min-h-11 rounded border px-3" onClick={() => run({ action: "DELETE_PREVIEW", id: row.id, expectedVersion: row.version })}>{text.previewDelete}</button>}
      </div>
      {Object.keys(text.states).some((state) => canTransition(row.status, state) && state !== "COMPLETED" && (state !== "APPROVED" || mfaAvailable)) && <form onSubmit={(event) => update(event, row)} className="space-y-2">
        <label className="block">{text.update}<select name="status" className="min-h-11 w-full rounded border p-2">{Object.entries(text.states).filter(([value]) => value !== "COMPLETED" && (value !== "APPROVED" || mfaAvailable) && canTransition(row.status, value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block">{text.reason}<textarea name="reason" required minLength={3} maxLength={2000} className="min-h-24 w-full rounded border p-2" /></label>
        <button disabled={busy} className="min-h-11 rounded border px-4" type="submit">{busy ? text.working : text.update}</button>
      </form>}
      {!["COMPLETED", "REJECTED"].includes(row.status) && row.request_type !== "COMPLAINT" && <details><summary className="min-h-11 py-2">{text.extension}</summary>
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); run({ action: "EXTEND", id: row.id, expectedVersion: row.version,
          days: Number(data.get("days")), reason: data.get("reason"), notifiedAt: new Date(String(data.get("notifiedAt"))).toISOString(), deliveryEvidence: data.get("evidence") }); }}>
          <label className="block">{text.extensionDays}<input name="days" type="number" min={1} max={["ACCESS", "COPY"].includes(row.request_type) ? 15 : 30} required className="min-h-11 w-full rounded border p-2" /></label>
          <label className="block">{text.extensionReason}<textarea name="reason" minLength={3} maxLength={2000} required className="w-full rounded border p-2" /></label>
          <label className="block">{text.notifiedAt}<input name="notifiedAt" type="datetime-local" required className="min-h-11 w-full rounded border p-2" /></label>
          <label className="block">{text.deliveryEvidence}<input name="evidence" minLength={8} maxLength={300} required className="min-h-11 w-full rounded border p-2" /></label>
          <button disabled={busy} className="min-h-11 rounded border px-4">{text.saveExtension}</button>
        </form></details>}
      {["COMPLAINT", "CORRECT", "STOP", "MARKETING_STOP"].includes(row.request_type) && ["APPROVED", "EXECUTING"].includes(row.status) && <details><summary className="min-h-11 py-2">{text.resultEntry}</summary>
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); run({ action: "RECORD_RESULT", id: row.id, expectedVersion: row.version, reason: data.get("reason"), executionEvidence: data.get("evidence") }); }}>
          <p>{text.resultInstruction}</p>
          <label className="block">{text.resultReason}<textarea name="reason" minLength={3} maxLength={2000} required className="w-full rounded border p-2" /></label>
          <label className="block">{text.resultEvidence}<input name="evidence" minLength={8} maxLength={300} required className="min-h-11 w-full rounded border p-2" /></label>
          <button disabled={busy} className="min-h-11 rounded border px-4">{text.saveResult}</button>
        </form></details>}
      </article>)}
    <div className="flex gap-3"><button className="min-h-11 rounded border px-4" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>{text.previous}</button><button className="min-h-11 rounded border px-4" disabled={rows.length < 5 || busy} onClick={() => setPage(page + 1)}>{text.next}</button></div>
  </section>;
}
