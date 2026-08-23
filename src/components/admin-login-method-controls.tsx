"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Apple, KeyRound, Laptop, MessageCircle, Search } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { getAdminApiError } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

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
  readyForOAuthOnly,
}: {
  initialPasswordEnabled: boolean;
  initialFoundationEnabled: boolean;
  initialProviders: Record<OAuthProvider, boolean>;
  configuredProviders: Record<OAuthProvider, boolean>;
  readyForOAuthOnly: boolean;
}) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [passwordEnabled, setPasswordEnabled] = useState(initialPasswordEnabled);
  const [foundationEnabled, setFoundationEnabled] = useState(initialFoundationEnabled);
  const [providers, setProviders] = useState(initialProviders);
  const [updating, setUpdating] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

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

  async function togglePassword() {
    const nextEnabled = !passwordEnabled;
    if (!nextEnabled && (!readyForOAuthOnly || visibleProviderCount === 0)) {
      setNotice(m("Password sign-in cannot be disabled until privileged accounts are linked and at least one configured OAuth method is enabled."));
      return;
    }
    if (!window.confirm(m("This change takes effect immediately and will be written to the audit log. Continue?"))) return;
    setUpdating("PASSWORD");
    setNotice("");
    try {
      await setGlobalFlag("OAUTH_ONLY_LOGIN_UI_ENABLED", !nextEnabled);
      setPasswordEnabled(nextEnabled);
      setNotice(m("Login method updated."));
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : m("Operation failed. Try again later."));
    } finally {
      setUpdating(null);
    }
  }

  async function toggleProvider(provider: OAuthProvider, code: ProviderFlagCode) {
    const nextEnabled = !providerVisible(provider);
    if (nextEnabled && !configuredProviders[provider]) {
      setNotice(m("Provider credentials are not configured."));
      return;
    }
    if (!nextEnabled && !passwordEnabled && visibleProviderCount <= 1) {
      setNotice(m("At least one sign-in method must remain available."));
      return;
    }
    if (!window.confirm(m("This change takes effect immediately and will be written to the audit log. Continue?"))) return;
    setUpdating(provider);
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
          description={m("Password sign-in remains available to existing merchant, staff, kitchen, and platform administrator accounts.")}
          enabled={passwordEnabled}
          busy={updating === "PASSWORD"}
          disabled={Boolean(updating)}
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
      {notice ? <p role="status" className="mt-4 border-t border-stone-200 pt-3 text-sm font-medium text-stone-700">{notice}</p> : null}
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
        <button type="button" role="switch" aria-checked={enabled} aria-label={label} disabled={disabled} onClick={onToggle} className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? "bg-teal-700" : "bg-stone-300"}`}>
          <span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`} />
        </button>
      </div>
      <p className={`mt-3 text-sm font-semibold ${enabled ? "text-teal-800" : "text-stone-500"}`}>{busy ? "…" : enabled ? enabledLabel : disabledLabel}</p>
    </article>
  );
}
