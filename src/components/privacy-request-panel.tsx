"use client";
import { useEffect, useRef, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { getOrCreateDeviceId, publicOrderCircuitHeaders } from "@/lib/public-order-client";
import { getPrivacyMessages } from "@/lib/messages/privacy";
import type { RequestType } from "@/server/compliance/contracts";

type Receipt = { id: string; organizationId: string; receipt: string; type?: RequestType; status: string; dueAt: string; decision?: string | null };
export function PrivacyRequestPanel({ trackingToken, organizationId, locale = "zh-TW" }: { trackingToken?: string; organizationId?: string; locale?: string }) {
  const text = getPrivacyMessages(locale);
  const [policy, setPolicy] = useState<{ version: string; notice_text: string } | null>(null);
  const [type, setType] = useState<RequestType>("ACCESS");
  const [details, setDetails] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedReceipt, setSavedReceipt] = useState("");
  const [exportData, setExportData] = useState<{ data: unknown; sha256: string } | null>(null);
  const operationId = useRef("");
  useEffect(() => { const controller = new AbortController();
    fetch("/api/privacy/policy", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); setPolicy(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setError(text.unavailable); });
    return () => controller.abort();
  }, [text.unavailable]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!policy || busy) return;
    setBusy(true); setError(""); operationId.current ||= crypto.randomUUID();
    try {
      const command = { operationId: operationId.current, type, details, policyVersion: policy.version };
      const headers = trackingToken ? { ...csrfHeaders(), ...publicOrderCircuitHeaders(operationId.current), "x-stallorder-device-id": getOrCreateDeviceId() } : csrfHeaders();
      const response = await fetch("/api/privacy/requests", { method: "POST", headers, cache: "no-store",
        body: JSON.stringify(trackingToken ? { subject: "ORDER", trackingToken, command } : { subject: "ACCOUNT", organizationId, command }) });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error();
      setReceipt(await response.json());
    } catch { setError(text.unavailable); } finally { setBusy(false); }
  }
  async function refresh() {
    if (!receipt || busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/privacy/receipt", { method: "POST", cache: "no-store", headers: csrfHeaders(), body: JSON.stringify({ receipt: receipt.receipt, organizationId: receipt.organizationId }) });
      if (!response.ok) throw new Error();
      setReceipt({ ...receipt, ...await response.json() });
    } catch { setError(text.unavailable); } finally { setBusy(false); }
  }
  async function recover(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    const [organizationId, token] = savedReceipt.trim().split(":");
    try {
      const response = await fetch("/api/privacy/receipt", { method: "POST", cache: "no-store", headers: csrfHeaders(), body: JSON.stringify({ receipt: token, organizationId }) });
      if (!response.ok) throw new Error(); setReceipt({ ...await response.json(), organizationId, receipt: token }); setSavedReceipt("");
    } catch { setError(text.unavailable); } finally { setBusy(false); }
  }
  async function receiveExport(acknowledge = false) {
    if (!receipt || busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/privacy/export", { method: "POST", cache: "no-store", headers: csrfHeaders(),
        body: JSON.stringify({ organizationId: receipt.organizationId, receipt: receipt.receipt,
          ...(acknowledge && exportData ? { acknowledgement: exportData.sha256 } : {}) }) });
      if (!response.ok) throw new Error();
      if (acknowledge) setReceipt({ ...receipt, status: "COMPLETED" }); else setExportData(await response.json());
    } catch { setError(text.unavailable); } finally { setBusy(false); }
  }
  return <section className="mx-auto my-6 w-full max-w-2xl space-y-4 rounded-2xl border p-4" aria-label={text.title}>
    <h2 className="text-xl font-semibold">{text.title}</h2><p>{text.intro}</p>
    {policy && <details><summary className="min-h-11 cursor-pointer py-2">{text.notice} · {policy.version}</summary><p className="whitespace-pre-wrap break-words">{policy.notice_text}</p></details>}
    {error && <p role="alert">{error}</p>}
    {receipt ? <div className="space-y-3 break-all" aria-live="polite">
      <p>{text.receipt}</p><p>{receipt.id}</p><p>{receipt.organizationId}:{receipt.receipt}</p>
      <p>{text.states[receipt.status as keyof typeof text.states] ?? receipt.status}</p><p>{text.due}: {new Date(receipt.dueAt).toLocaleString(locale, { timeZone: "Asia/Taipei" })}</p>
      {receipt.decision && <p className="whitespace-pre-wrap">{receipt.decision}</p>}
      <button className="min-h-11 rounded border px-4" type="button" disabled={busy} onClick={refresh}>{busy ? text.working : text.refresh}</button>
      {["ACCESS", "COPY"].includes(receipt.type ?? "") && ["EXECUTING", "COMPLETED"].includes(receipt.status) && <button className="ml-2 min-h-11 rounded border px-4" type="button" disabled={busy} onClick={() => receiveExport()}>{text.collect}</button>}
      {exportData && <div className="space-y-2"><p>{text.exportScope}</p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border p-3">{JSON.stringify(exportData.data, null, 2)}</pre>
        <button className="min-h-11 rounded border px-4" type="button" disabled={busy} onClick={() => receiveExport(true)}>{text.acknowledge}</button>
      </div>}
    </div> : <form onSubmit={submit} className="space-y-4">
      <label className="block">{text.type}<select className="mt-1 min-h-11 w-full rounded border p-2" value={type} onChange={(event) => setType(event.target.value as RequestType)}>{Object.entries(text.types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block">{text.details}<textarea className="mt-1 min-h-28 w-full rounded border p-2" required maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <button className="min-h-11 rounded border px-4" disabled={busy || !policy} type="submit">{busy ? text.working : text.submit}</button>
    </form>}
    {!receipt && <details><summary className="min-h-11 cursor-pointer py-2">{text.recover}</summary><form onSubmit={recover} className="space-y-3">
      <label className="block">{text.fullReceipt}<input value={savedReceipt} onChange={(event) => setSavedReceipt(event.target.value)} required autoComplete="off" maxLength={100} className="min-h-11 w-full rounded border p-2" /></label>
      <button type="submit" disabled={busy} className="min-h-11 rounded border px-4">{text.lookup}</button>
    </form></details>}
  </section>;
}
