"use client";

import { useState } from "react";
import { Check, CirclePause, RotateCcw, TestTube2, Unplug, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

export function AdminDeliveryRequestActions({ requestId }: { requestId: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function run(action: "REQUEST_INFORMATION" | "APPROVE_CONFIGURATION" | "REJECT") {
    const note = window.prompt(
      action === "REQUEST_INFORMATION"
        ? "請輸入需補充的資料："
        : action === "REJECT"
          ? "請輸入拒絕原因："
          : "請輸入本次審核備註：",
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
      setMessage(typeof result.error === "string" ? result.error : "操作失敗。");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => run("APPROVE_CONFIGURATION")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white"><Check className="h-4 w-4" />核准設定</button>
      <button type="button" disabled={pending} onClick={() => run("REQUEST_INFORMATION")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold">要求補件</button>
      <button type="button" disabled={pending} onClick={() => run("REJECT")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800"><X className="h-4 w-4" />拒絕</button>
      <span role="status" className="text-sm text-red-700">{message}</span>
    </div>
  );
}

export function AdminDeliveryConnectionActions({
  connectionId,
  status,
}: {
  connectionId: string;
  status: string;
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function setStatus(nextStatus: "TESTING" | "ACTIVE" | "PAUSED" | "DISCONNECTED") {
    if (nextStatus === "DISCONNECTED" && !window.confirm("確定解除此外送平台連線？")) return;
    setPending(true);
    const response = await fetch(`/api/admin/delivery-connections/${connectionId}`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify({ action: "SET_STATUS", status: nextStatus }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(typeof result.error === "string" ? result.error : "操作失敗。");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "TESTING" ? <button type="button" disabled={pending} onClick={() => setStatus("TESTING")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><TestTube2 className="h-4 w-4" />移至測試</button> : null}
      {status !== "ACTIVE" ? <button type="button" disabled={pending} onClick={() => setStatus("ACTIVE")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white"><Check className="h-4 w-4" />啟用</button> : null}
      {status !== "PAUSED" ? <button type="button" disabled={pending} onClick={() => setStatus("PAUSED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><CirclePause className="h-4 w-4" />暫停</button> : null}
      {status !== "DISCONNECTED" ? <button type="button" disabled={pending} onClick={() => setStatus("DISCONNECTED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800"><Unplug className="h-4 w-4" />解除</button> : null}
      <span role="status" className="text-sm text-red-700">{message}</span>
    </div>
  );
}

export function AdminDeliveryJobRetry({
  connectionId,
  jobId,
}: {
  connectionId: string;
  jobId: string;
}) {
  const [pending, setPending] = useState(false);
  async function retry() {
    setPending(true);
    const response = await fetch(`/api/admin/delivery-connections/${connectionId}`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify({ action: "RETRY_JOB", jobId }),
    });
    setPending(false);
    if (response.ok) window.location.reload();
  }
  return <button type="button" disabled={pending} onClick={retry} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><RotateCcw className="h-4 w-4" />核准重試</button>;
}

export function AdminDeliveryStoreVerify({
  connectionId,
  mappingId,
}: {
  connectionId: string;
  mappingId: string;
}) {
  const [pending, setPending] = useState(false);
  async function verify() {
    setPending(true);
    const response = await fetch(`/api/admin/delivery-connections/${connectionId}`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify({ action: "VERIFY_STORE", mappingId }),
    });
    setPending(false);
    if (response.ok) window.location.reload();
  }
  return <button type="button" disabled={pending} onClick={verify} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Check className="h-4 w-4" />驗證門市</button>;
}
