"use client";
import { useState } from "react";
import { getPrivacyMessages } from "@/lib/messages/privacy";
import { createOptionalSupabaseBrowserClient } from "@/lib/supabase-browser";
export function PrivacyMfaSetup({ locale }: { locale: string }) {
  const text = getPrivacyMessages(locale);
  const [factor, setFactor] = useState<{ id: string; qr: string } | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function enroll() {
    setBusy(true); setMessage("");
    try {
      const auth = createOptionalSupabaseBrowserClient(); if (!auth) throw new Error();
      const result = await auth.auth.mfa.enroll({ factorType: "totp", friendlyName: text.mfaLabel });
      if (result.error) throw new Error();
      setFactor({ id: result.data.id, qr: result.data.totp.qr_code });
    } catch { setMessage(text.mfaUnavailable); } finally { setBusy(false); }
  }
  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!factor) return; setBusy(true);
    const code = String(new FormData(event.currentTarget).get("code"));
    try {
      const auth = createOptionalSupabaseBrowserClient(); if (!auth) throw new Error();
      const result = await auth.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (result.error) throw new Error(); setFactor(null); setMessage(text.mfaEnabled);
    } catch { setMessage(text.mfaFailed); } finally { setBusy(false); }
  }
  return <details className="rounded-xl border p-4"><summary className="min-h-11 cursor-pointer">{text.mfaSetup}</summary>
    <p>{text.mfaDescription}</p>
    {message && <p role="status">{message}</p>}
    {!factor ? <button type="button" className="min-h-11 rounded border px-4" disabled={busy} onClick={enroll}>{text.mfaAdd}</button> :
      <form onSubmit={verify} className="space-y-3">
        {/* Provider-generated SVG is rendered as an image, never inserted as markup. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={factor.qr.startsWith("data:image/svg+xml") ? factor.qr : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(factor.qr)}`} width={240} height={240} alt={text.mfaQr} />
        <label className="block">{text.mfaCode}<input name="code" required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" className="min-h-11 rounded border p-2" /></label>
        <button disabled={busy} className="min-h-11 rounded border px-4">{text.mfaConfirm}</button>
      </form>}
  </details>;
}
