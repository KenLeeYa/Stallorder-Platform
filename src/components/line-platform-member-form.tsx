"use client";
import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
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
  return <form className="mini-card space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {!enrolled && <label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1 size-5 shrink-0" type="checkbox" disabled={!ready || busy} checked={accepted} onChange={event => setAccepted(event.target.checked)} />
      <span>我已閱讀並同意攤點通<a className="underline" href="/mini/terms">會員條款與隱私說明</a>（{termsVersion}）。</span></label>}
    <fieldset className="space-y-3" disabled={!ready || busy}><legend className="font-semibold">訂單與取餐通知</legend>
      <div className="mini-choice"><label><input type="radio" name="notification-consent" value="on" checked={consent} onChange={() => setConsent(true)} disabled={!ready || busy} /><Bell aria-hidden="true" />接收通知</label>
      <label><input type="radio" name="notification-consent" value="off" checked={!consent} onChange={() => setConsent(false)} disabled={!ready || busy} /><BellOff aria-hidden="true" />暫不接收</label></div>
    </fieldset>
    <p className="mini-muted">選填，可隨時關閉。不接收通知仍可查看訂單，且此設定不包含行銷訊息。</p>
    <p className="mini-muted">加入會員與加入好友是不同設定；接收通知也需要加入攤點通好友。</p>
    <button type="submit" className="mini-primary w-full disabled:opacity-50" disabled={!ready || busy || !accepted}>{busy ? "儲存中…" : enrolled ? "儲存通知設定" : "加入平台會員"}</button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </form>;
}
