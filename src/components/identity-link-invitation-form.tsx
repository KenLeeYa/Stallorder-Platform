"use client";

import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";

const labels: Record<string, string> = {
  GOOGLE: "使用 Google 綁定",
  LINE: "使用 LINE 綁定",
  APPLE: "使用 Apple 綁定",
};

export function IdentityLinkInvitationForm({
  token,
  providers,
}: {
  token: string;
  providers: string[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function start(provider: string) {
    setPending(provider);
    setError("");
    try {
      const response = await fetch(`/api/auth/identities/${provider.toLowerCase()}`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          invitationToken: token,
          returnTo: "/select-organization",
        }),
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.authorizationUrl !== "string") {
        throw new Error(payload.error ?? "目前無法啟動帳號綁定。");
      }
      window.location.assign(payload.authorizationUrl);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "目前無法啟動帳號綁定。");
      setPending(null);
    }
  }

  return (
    <div className="mt-6 grid gap-3">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          disabled={pending !== null}
          onClick={() => void start(provider)}
          className="min-h-12 border border-stone-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
        >
          {pending === provider ? "前往驗證中..." : labels[provider] ?? `使用 ${provider} 綁定`}
        </button>
      ))}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
