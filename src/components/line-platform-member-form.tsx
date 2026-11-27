"use client";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { useClientReady } from "@/components/use-client-ready";

export function LinePlatformMemberForm({ termsVersion, enrolled = false }: {
  termsVersion: string; enrolled?: boolean;
}) {
  const ready = useClientReady();
  const [accepted, setAccepted] = useState(enrolled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (enrolled || !ready || busy || !accepted) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mini/member", { method: "POST", headers: csrfHeaders(),
        body: JSON.stringify({ acceptTerms: accepted, termsVersion }) });
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch { setError("設定尚未儲存，請重新登入後再試。"); }
    finally { setBusy(false); }
  }
  if (enrolled) return null;
  return <form className="mini-card space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1 size-5 shrink-0" type="checkbox" disabled={!ready || busy} checked={accepted} onChange={event => setAccepted(event.target.checked)} />
      <span>我已閱讀並同意攤點通<a className="underline" href="/mini/terms">會員條款與隱私說明</a>（{termsVersion}）。</span></label>
    <button type="submit" className="mini-primary w-full disabled:opacity-50" disabled={!ready || busy || !accepted}>{busy ? "儲存中…" : "加入平台會員"}</button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </form>;
}
