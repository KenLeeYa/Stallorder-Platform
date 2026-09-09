import { LoginForm } from "@/components/login-form";
import { LoginShell } from "@/components/login-shell";
import { isSupabaseAuthConfigured } from "@/lib/supabase-auth";
import { getOAuthLoginUiConfig } from "@/server/auth/oauth/provider-registry";

export const dynamic = "force-dynamic";

const providerLabels = {
  GOOGLE: "Google",
  LINE: "LINE",
  APPLE: "Apple",
  MICROSOFT: "Microsoft",
} as const;

const localQaAccounts = [
  { label: "店員", email: "staff@stallorder.test", password: "StallOrderDemo!2026" },
  { label: "廚房", email: "kitchen@stallorder.test", password: "StallOrderDemo!2026" },
] as const;

export default async function StaffLoginPage() {
  const oauth = await getOAuthLoginUiConfig();
  const providers = oauth.providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      provider: provider.provider,
      label: providerLabels[provider.provider],
    }));
  const googleProvider = oauth.providers.find((provider) => provider.provider === "GOOGLE");
  const legacyGoogleEnabled = !oauth.oauthOnly
    && Boolean(googleProvider?.requested)
    && isSupabaseAuthConfigured()
    && !providers.some((provider) => provider.provider === "GOOGLE");
  const localQaQuickLoginEnabled = process.env.NODE_ENV === "development"
    && process.env.LOCAL_QA_QUICK_LOGIN_ENABLED === "true";

  return (
    <LoginShell>
      <LoginForm
        audience="STAFF"
        legacyGoogleEnabled={legacyGoogleEnabled}
        oauthOnly={oauth.oauthOnly}
        oauthProviders={providers}
        localQaAccounts={localQaQuickLoginEnabled ? [...localQaAccounts] : undefined}
      />
    </LoginShell>
  );
}
