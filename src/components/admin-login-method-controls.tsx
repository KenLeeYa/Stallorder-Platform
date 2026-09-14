"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Apple, KeyRound, Laptop, MessageCircle, Search } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { getAdminApiError } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";
import { SettingsFeedbackDialog } from "@/components/settings-feedback-dialog";

type OAuthProvider = "GOOGLE" | "LINE" | "APPLE" | "MICROSOFT";
type ProviderFlagCode = "OAUTH_GOOGLE_ENABLED" | "OAUTH_LINE_ENABLED" | "OAUTH_APPLE_ENABLED" | "OAUTH_MICROSOFT_ENABLED";

const providerControls = [
  { provider: "GOOGLE", code: "OAUTH_GOOGLE_ENABLED", label: "Google sign-in", icon: Search },
  { provider: "LINE", code: "OAUTH_LINE_ENABLED", label: "LINE sign-in", icon: MessageCircle },
  { provider: "APPLE", code: "OAUTH_APPLE_ENABLED", label: "Apple sign-in", icon: Apple },
  { provider: "MICROSOFT", code: "OAUTH_MICROSOFT_ENABLED", label: "Microsoft sign-in", icon: Laptop },
] as const satisfies ReadonlyArray<{
  provider: OAuthProvider;
  code: ProviderFlagCode;
  label: "Google sign-in" | "LINE sign-in" | "Apple sign-in" | "Microsoft sign-in";
  icon: typeof Search;
}>;

export function AdminLoginMethodControls({
  initialPasswordEnabled,
  initialFoundationEnabled,
  initialProviders,
  configuredProviders,
  passwordPolicyLocked,
}: {
  initialPasswordEnabled: boolean;
  initialFoundationEnabled: boolean;
  initialProviders: Record<OAuthProvider, boolean>;
  configuredProviders: Record<OAuthProvider, boolean>;
  passwordPolicyLocked: boolean;
}) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [passwordEnabled, setPasswordEnabled] = useState(initialPasswordEnabled);
  const [foundationEnabled, setFoundationEnabled] = useState(initialFoundationEnabled);
  const [providers, setProviders] = useState(initialProviders);
  const [updating, setUpdating] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [hasError, setHasError] = useState(false);
  const [confirmation, setConfirmation] = useState<{ run: () => Promise<void> } | null>(null);
  const confirmationRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = confirmationRef.current;
    if (!confirmation || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [confirmation]);

  const providerVisible = (provider: OAuthProvider) => (
    foundationEnabled && providers[provider] && configuredProviders[provider]
  );
  const visibleProviderCount = providerControls.filter(({ provider }) => providerVisible(provider)).length;

  async function setGlobalFlag(code: string, enabled: boolean) {
    const response = await fetch(`/api/admin/resilience/feature-flags/${code}`, {
      method: "PUT",
      headers: csrfHeaders(),
      body: JSON.stringify({
        scopeType: "GLOBAL",
        organizationId: null,
        stallId: null,
        deviceId: null,
        enabled,
        rolloutPercentage: null,
        expiresAt: null,
        reason: "平台管理員由登入方式控制介面切換",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(getAdminApiError(locale, payload));
  }

  async function togglePassword(confirmed = false) {
    const nextEnabled = !passwordEnabled;
    if (!nextEnabled && visibleProviderCount === 0) {
      setHasError(true);
      setNotice(m("At least one sign-in method must remain available."));
      return;
    }
    if (!confirmed) {
      setConfirmation({ run: () => togglePassword(true) });
      return;
    }
    setUpdating("PASSWORD");
    setHasError(false);
    setNotice("");
    try {
      await setGlobalFlag("AUTH_PASSWORD_LOGIN_ENABLED", nextEnabled);
      setPasswordEnabled(nextEnabled);
      setNotice(m("Login method updated."));
      router.refresh();
    } catch (error) {
      setHasError(true);
      setNotice(error instanceof Error ? error.message : m("Operation failed. Try again later."));
    } finally {
      setUpdating(null);
    }
  }

  async function toggleProvider(provider: OAuthProvider, code: ProviderFlagCode, confirmed = false) {
    const nextEnabled = !providerVisible(provider);
    if (nextEnabled && !configuredProviders[provider]) {
      setHasError(true);
      setNotice(m("Provider credentials are not configured."));
      return;
    }
    if (!nextEnabled && !passwordEnabled && visibleProviderCount <= 1) {
      setHasError(true);
      setNotice(m("At least one sign-in method must remain available."));
      return;
    }
    if (!confirmed) {
      setConfirmation({ run: () => toggleProvider(provider, code, true) });
      return;
    }
    setUpdating(provider);
    setHasError(false);
    setNotice("");
    try {
      if (nextEnabled && !foundationEnabled) {
        await setGlobalFlag("OAUTH_IDENTITY_FOUNDATION_ENABLED", true);
        setFoundationEnabled(true);
      }
      await setGlobalFlag(code, nextEnabled);
      setProviders((current) => ({ ...current, [provider]: nextEnabled }));
      setNotice(m("Login method updated."));
      router.refresh();
    } catch (error) {
      setHasError(true);
      setNotice(error instanceof Error ? error.message : m("Operation failed. Try again later."));
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section className="py-6" aria-label={m("Login method controls")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <MethodCard
          icon={KeyRound}
          label={m("Email and password")}
          description={passwordPolicyLocked
            ? m("The full OAuth-only migration policy is active. Password sign-in cannot be restored here.")
            : m("Turning this off blocks email/password sign-in only. Accounts and existing Google or LINE identities are preserved.")}
          enabled={passwordEnabled}
          busy={updating === "PASSWORD"}
          disabled={Boolean(updating) || passwordPolicyLocked}
          onToggle={() => void togglePassword()}
          enabledLabel={m("Enabled")}
          disabledLabel={m("Disabled")}
        />
        {providerControls.map(({ provider, code, label, icon }) => (
          <MethodCard
            key={provider}
            icon={icon}
            label={m(label)}
            description={configuredProviders[provider]
              ? m("OAuth methods appear only when their provider credentials are configured.")
              : m("Provider credentials are not configured.")}
            enabled={providerVisible(provider)}
            busy={updating === provider}
            disabled={Boolean(updating) || !configuredProviders[provider]}
            onToggle={() => void toggleProvider(provider, code)}
            enabledLabel={m("Enabled")}
            disabledLabel={m("Disabled")}
          />
        ))}
      </div>
      <dialog ref={confirmationRef} aria-labelledby="login-method-confirm-title" aria-describedby="login-method-confirm-description" onCancel={() => setConfirmation(null)} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-6 text-stone-950 shadow-2xl backdrop:bg-black/60">
        <h2 id="login-method-confirm-title" className="text-xl font-bold">{m("Login method controls")}</h2>
        <p id="login-method-confirm-description" className="mt-3 text-sm leading-6">{m("This change takes effect immediately and will be written to the audit log. Continue?")}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setConfirmation(null)} className="min-h-11 rounded-xl border border-stone-300 px-4 py-2 font-semibold">{m("Cancel change")}</button>
          <button type="button" onClick={() => {
            const action = confirmation;
            confirmationRef.current?.close();
            setConfirmation(null);
            void action?.run();
          }} className="min-h-11 rounded-xl bg-teal-800 px-4 py-2 font-semibold text-white">{m("Confirm change")}</button>
        </div>
      </dialog>
      {notice ? <SettingsFeedbackDialog message={notice} kind={hasError ? "error" : "success"} onClose={() => setNotice("")} /> : null}
    </section>
  );
}

function MethodCard({ icon: Icon, label, description, enabled, busy, disabled, onToggle, enabledLabel, disabledLabel }: {
  icon: typeof KeyRound;
  label: string;
  description: string;
  enabled: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  enabledLabel: string;
  disabledLabel: string;
}) {
  return (
    <article className="rounded-md border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold"><Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-teal-700" />{label}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label={label} disabled={disabled} onClick={onToggle} className={`relative mt-0.5 h-11 w-16 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? "bg-teal-700" : "bg-stone-300"}`}>
          <span className={`absolute left-1 top-2 h-7 w-7 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-7" : "translate-x-0"}`} />
        </button>
      </div>
      <p className={`mt-3 text-sm font-semibold ${enabled ? "text-teal-800" : "text-stone-500"}`}>{busy ? "…" : enabled ? enabledLabel : disabledLabel}</p>
    </article>
  );
}
