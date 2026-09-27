"use client";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { useClientReady } from "@/components/use-client-ready";

export function LinePlatformMemberForm({ termsVersion, enrolled = false, initialConsent = false }: {
  termsVersion: string; enrolled?: boolean; initialConsent?: boolean;
}) {
  const ready = useClientReady();
  const [accepted, setAccepted] = useState(enrolled);
  const [consent, setConsent] = useState(initialConsent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!ready || busy || !accepted) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mini/member", { method: enrolled ? "PATCH" : "POST", headers: csrfHeaders(),
        body: JSON.stringify(enrolled ? { notificationConsent: consent } : { acceptTerms: accepted, termsVersion, notificationConsent: consent }) });
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch { setError("設定尚未儲存，請重新登入後再試。"); }
    finally { setBusy(false); }
  }
  return <form className="space-y-3 rounded-xl border border-stone-300 p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {!enrolled && <label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1 size-5 shrink-0" type="checkbox" disabled={!ready || busy} checked={accepted} onChange={event => setAccepted(event.target.checked)} />
      <span>我已閱讀並同意攤點通<a className="underline" href="/mini/terms">會員條款與隱私說明</a>（{termsVersion}）。</span></label>}
    <label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1 size-5 shrink-0" type="checkbox" disabled={!ready || busy} checked={consent} onChange={event => setConsent(event.target.checked)} />
      <span>接收攤點通官方帳號的訂單及取餐通知（選填，可隨時關閉）。</span></label>
    <p className="text-sm text-stone-500">加入會員與加入好友是不同設定；不勾選仍可使用會員訂單。此設定不包含行銷訊息。</p>
    <button type="submit" className="min-h-11 w-full rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={!ready || busy || !accepted}>{busy ? "儲存中…" : enrolled ? "儲存通知設定" : "加入平台會員"}</button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </form>;
}
