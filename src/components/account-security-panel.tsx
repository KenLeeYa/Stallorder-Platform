"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfHeaders } from "@/lib/csrf-client";

type Provider = {
  provider: "GOOGLE" | "LINE" | "APPLE" | "MICROSOFT";
  label: string;
  enabled: boolean;
  linkedAt: string | null;
};

type Session = {
  id: string;
  label: string;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

type Copy = {
  loginMethods: string;
  loginDescription: string;
  linked: string;
  notLinked: string;
  link: string;
  unlink: string;
  lastLinked: string;
  unavailable: string;
  lastIdentityWarning: string;
  sessions: string;
  sessionsDescription: string;
  currentDevice: string;
  otherDevice: string;
  lastActive: string;
  expires: string;
  logoutDevice: string;
  logoutAll: string;
  passkeys: string;
  passkeyReady: string;
  passkeyBlocked: string;
  actionFailed: string;
  confirmUnlink: string;
  confirmLogoutAll: string;
};

export function AccountSecurityPanel({
  initialProviders,
  initialSessions,
  passkeyCount,
  passkeysEnabled,
  copy,
}: {
  initialProviders: Provider[];
  initialSessions: Session[];
  passkeyCount: number;
  passkeysEnabled: boolean;
  copy: Copy;
}) {
  const router = useRouter();
  const [providers] = useState(initialProviders);
  const [sessions, setSessions] = useState(initialSessions);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const activeIdentityCount = providers.filter((provider) => provider.linkedAt).length;

  async function link(provider: Provider["provider"]) {
    setPending(`link:${provider}`);
    setMessage("");
    const response = await fetch(`/api/auth/identities/${provider.toLowerCase()}`, {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({ returnTo: "/merchant/account/security" }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && typeof body.authorizationUrl === "string") {
      window.location.assign(body.authorizationUrl);
      return;
    }
    setMessage(typeof body.error === "string" ? body.error : copy.actionFailed);
    setPending(null);
  }

  async function unlink(provider: Provider["provider"]) {
    if (!window.confirm(copy.confirmUnlink)) return;
    setPending(`unlink:${provider}`);
    setMessage("");
    const response = await fetch(`/api/auth/identities/${provider.toLowerCase()}`, {
      method: "DELETE",
      headers: csrfHeaders(),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      router.push("/login");
      router.refresh();
      return;
    }
    setMessage(typeof body.error === "string" ? body.error : copy.actionFailed);
    setPending(null);
  }

  async function revokeSession(sessionId: string) {
    setPending(`session:${sessionId}`);
    setMessage("");
    const response = await fetch(`/api/auth/sessions/${sessionId}`, {
      method: "DELETE",
      headers: csrfHeaders(),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.currentSession) {
      router.push("/login");
      router.refresh();
      return;
    }
    if (response.ok) {
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setPending(null);
      return;
    }
    setMessage(typeof body.error === "string" ? body.error : copy.actionFailed);
    setPending(null);
  }

  async function logoutAll() {
    if (!window.confirm(copy.confirmLogoutAll)) return;
    setPending("logout-all");
    const response = await fetch("/api/auth/logout-all", {
      method: "POST",
      headers: csrfHeaders(),
    });
    if (response.ok) {
      router.push("/login");
      router.refresh();
      return;
    }
    setMessage(copy.actionFailed);
    setPending(null);
  }

  return (
    <div className="space-y-8">
      {message ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</p> : null}
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">{copy.loginMethods}</h2>
        <p className="mt-1 text-sm text-stone-600">{copy.loginDescription}</p>
        <div className="mt-5 divide-y divide-stone-200">
          {providers.map((provider) => {
            const linked = Boolean(provider.linkedAt);
            const unlinkBlocked = activeIdentityCount <= 1 || provider.provider === "APPLE";
            return (
              <div key={provider.provider} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <h3 className="font-semibold">{provider.label}</h3>
                  <p className="mt-1 text-sm text-stone-600">
                    {linked ? copy.linked : provider.enabled ? copy.notLinked : copy.unavailable}
                    {provider.linkedAt ? ` · ${copy.lastLinked} ${provider.linkedAt}` : ""}
                  </p>
                  {linked && activeIdentityCount <= 1 ? <p className="mt-1 text-xs text-amber-700">{copy.lastIdentityWarning}</p> : null}
                </div>
                {linked ? (
                  <button type="button" disabled={unlinkBlocked || pending !== null} onClick={() => unlink(provider.provider)} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{copy.unlink}</button>
                ) : (
                  <button type="button" disabled={!provider.enabled || pending !== null} onClick={() => link(provider.provider)} className="min-h-11 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{copy.link}</button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-xl font-semibold">{copy.sessions}</h2><p className="mt-1 text-sm text-stone-600">{copy.sessionsDescription}</p></div>
          <button type="button" disabled={pending !== null} onClick={logoutAll} className="min-h-11 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">{copy.logoutAll}</button>
        </div>
        <div className="mt-5 divide-y divide-stone-200">
          {sessions.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div><h3 className="font-semibold">{session.current ? copy.currentDevice : session.label || copy.otherDevice}</h3><p className="mt-1 text-sm text-stone-600">{copy.lastActive} {session.lastSeenAt} · {copy.expires} {session.expiresAt}</p></div>
              <button type="button" disabled={pending !== null} onClick={() => revokeSession(session.id)} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{copy.logoutDevice}</button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">{copy.passkeys}</h2>
        <p className="mt-2 text-sm text-stone-600">{passkeysEnabled ? copy.passkeyReady : copy.passkeyBlocked}</p>
        <p className="mt-2 text-sm font-semibold">{passkeyCount}</p>
      </section>
    </div>
  );
}
