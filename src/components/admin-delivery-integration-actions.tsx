"use client";

import { useState } from "react";
import { Check, CirclePause, RotateCcw, TestTube2, Unplug, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { getAdminApiError } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

export function AdminDeliveryRequestActions({ requestId }: { requestId: string }) {
  const { locale, m } = useAdminLocale();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function run(action: "REQUEST_INFORMATION" | "APPROVE_CONFIGURATION" | "REJECT") {
    const note = window.prompt(
      action === "REQUEST_INFORMATION"
        ? m("Enter the requested information:")
        : action === "REJECT"
          ? m("Enter the rejection reason:")
          : m("Enter a review note:"),
    );
    if (!note?.trim()) return;
    setPending(true);
    const response = await fetch(`/api/admin/delivery-integrations/${requestId}`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify({ action, adminNote: note.trim() }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(getAdminApiError(locale, result));
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => run("APPROVE_CONFIGURATION")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white"><Check className="h-4 w-4" />{m("Approve configuration")}</button>
      <button type="button" disabled={pending} onClick={() => run("REQUEST_INFORMATION")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold">{m("Request information")}</button>
      <button type="button" disabled={pending} onClick={() => run("REJECT")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800"><X className="h-4 w-4" />{m("Reject")}</button>
      <span role="status" className="text-sm text-red-700">{message}</span>
    </div>
  );
}

export function AdminDeliveryConnectionActions({ connectionId, status }: { connectionId: string; status: string }) {
  const { locale, m } = useAdminLocale();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function setStatus(nextStatus: "TESTING" | "ACTIVE" | "PAUSED" | "DISCONNECTED") {
    if (nextStatus === "DISCONNECTED" && !window.confirm(m("Disconnect this delivery connection?"))) return;
    setPending(true);
    const response = await fetch(`/api/admin/delivery-connections/${connectionId}`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify({ action: "SET_STATUS", status: nextStatus }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(getAdminApiError(locale, result));
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "TESTING" ? <button type="button" disabled={pending} onClick={() => setStatus("TESTING")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><TestTube2 className="h-4 w-4" />{m("Move to testing")}</button> : null}
      {status !== "ACTIVE" ? <button type="button" disabled={pending} onClick={() => setStatus("ACTIVE")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white"><Check className="h-4 w-4" />{m("Enable")}</button> : null}
      {status !== "PAUSED" ? <button type="button" disabled={pending} onClick={() => setStatus("PAUSED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><CirclePause className="h-4 w-4" />{m("Pause")}</button> : null}
      {status !== "DISCONNECTED" ? <button type="button" disabled={pending} onClick={() => setStatus("DISCONNECTED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800"><Unplug className="h-4 w-4" />{m("Disconnect")}</button> : null}
      <span role="status" className="text-sm text-red-700">{message}</span>
    </div>
  );
}

export function AdminDeliveryJobRetry({ connectionId, jobId }: { connectionId: string; jobId: string }) {
  const { m } = useAdminLocale();
  const [pending, setPending] = useState(false);
  async function retry() {
    setPending(true);
    const response = await fetch(`/api/admin/delivery-connections/${connectionId}`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({ action: "RETRY_JOB", jobId }) });
    setPending(false);
    if (response.ok) window.location.reload();
  }
  return <button type="button" disabled={pending} onClick={retry} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><RotateCcw className="h-4 w-4" />{m("Approve retry")}</button>;
}

export function AdminDeliveryStoreVerify({ connectionId, mappingId }: { connectionId: string; mappingId: string }) {
  const { m } = useAdminLocale();
  const [pending, setPending] = useState(false);
  async function verify() {
    setPending(true);
    const response = await fetch(`/api/admin/delivery-connections/${connectionId}`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({ action: "VERIFY_STORE", mappingId }) });
    setPending(false);
    if (response.ok) window.location.reload();
  }
  return <button type="button" disabled={pending} onClick={verify} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Check className="h-4 w-4" />{m("Verify store")}</button>;
}
