"use client";

import { useState } from "react";

export function LineMiniAppLogin({ liffId, endpointUrl }: { liffId: string; endpointUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { default: liff } = await import("@/lib/line-miniapp-liff");
      await liff.init({ liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: endpointUrl });
        return;
      }
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error("ID_TOKEN_MISSING");
      const challengeResponse = await fetch("/api/mini/auth/challenge", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnTo: "/mini" }),
      });
      if (!challengeResponse.ok) throw new Error("CHALLENGE_FAILED");
      const { challenge } = await challengeResponse.json();
      const response = await fetch("/api/mini/auth/exchange", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge, idToken }),
      });
      if (!response.ok) throw new Error("EXCHANGE_FAILED");
      // The raw ID token is never stored or copied into links/analytics.
      window.location.replace("/mini");
    } catch {
      setError("LINE 登入未完成。請確認使用測試帳號並允許登入，再重新嘗試。");
    } finally { setBusy(false); }
  }
  return <div>
    <button type="button" disabled={busy} onClick={() => void login()}
      className="min-h-12 w-full rounded-lg bg-teal-800 px-4 py-3 font-semibold text-white disabled:opacity-50">
      {busy ? "正在驗證 LINE 身分…" : "使用 LINE 顧客身分登入"}
    </button>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
  </div>;
}
