"use client";

import { useState } from "react";
import { useAppLocale } from "@/components/locale-provider";
import { csrfHeaders } from "@/lib/csrf-client";
import { publicMessages } from "@/lib/messages/public";

export function IdentityLinkInvitationForm({
  token,
  providers,
}: {
  token: string;
  providers: string[];
}) {
  const { locale } = useAppLocale();
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
        throw new Error(publicMessages.get(locale, "authLinkError"));
      }
      window.location.assign(payload.authorizationUrl);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : publicMessages.get(locale, "authLinkError"));
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
          {pending === provider
            ? publicMessages.get(locale, "authLinkStarting")
            : publicMessages.get(
                locale,
                provider === "GOOGLE"
                  ? "authLinkGoogle"
                  : provider === "LINE"
                    ? "authLinkLine"
                    : provider === "APPLE"
                      ? "authLinkApple"
                      : "authLinkProvider",
                { provider },
              )}
        </button>
      ))}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
