import { KeyRound, ShieldCheck } from "lucide-react";
import { AdminLoginMethodControls } from "@/components/admin-login-method-controls";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { createAdminTranslator } from "@/lib/messages/admin";
import { isSupabaseAuthConfigured } from "@/lib/supabase-auth";
import { resolveOAuthLoginFeatureState } from "@/server/auth/oauth/feature-flags";
import { getOAuthMigrationReadiness } from "@/server/auth/oauth/migration-readiness";
import { getOAuthLoginUiConfig } from "@/server/auth/oauth/provider-registry";

export const dynamic = "force-dynamic";

export default async function AdminLoginMethodsPage() {
  await requirePlatformAdminPage("/admin/login-methods");
  const [{ locale }, state, uiConfig, readiness] = await Promise.all([
    getRequestAppLocale(),
    resolveOAuthLoginFeatureState(),
    getOAuthLoginUiConfig(),
    getOAuthMigrationReadiness(),
  ]);
  const m = createAdminTranslator(locale);
  const configured = Object.fromEntries(uiConfig.providers.map((provider) => [
    provider.provider,
    provider.configured || (provider.provider === "GOOGLE" && isSupabaseAuthConfigured()),
  ])) as Record<"GOOGLE" | "LINE" | "APPLE" | "MICROSOFT", boolean>;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-teal-800"><ShieldCheck className="h-4 w-4" />{m("Platform administrators only")}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><KeyRound className="h-7 w-7 text-teal-700" />{m("Login method controls")}</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">{m("Choose which sign-in methods appear on the public login page. Disabled methods are also rejected by their server endpoints.")}</p>
      </header>
      <AdminLoginMethodControls
        initialPasswordEnabled={!state.oauthOnly}
        initialFoundationEnabled={state.foundation}
        initialProviders={state.providers}
        configuredProviders={configured}
        readyForOAuthOnly={readiness.readyForOAuthOnly}
      />
    </main>
  );
}
