import { LoginApplicationPrompt } from "@/components/login-application-prompt";
import { LoginForm } from "@/components/login-form";
import { LocaleSelector } from "@/components/locale-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseAuthConfigured } from "@/lib/supabase-auth";
import { getOAuthLoginUiConfig } from "@/server/auth/oauth/provider-registry";

export const dynamic = "force-dynamic";

const providerLabels = {
  GOOGLE: "Google",
  LINE: "LINE",
  APPLE: "Apple",
} as const;

export default async function LoginPage() {
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
  const applicationProvider = providers.find((provider) => provider.provider === "GOOGLE")
    ?? providers.find((provider) => provider.provider === "APPLE");
  const applicationUrl = applicationProvider
    ? `/api/auth/${applicationProvider.provider.toLowerCase()}/start?next=%2Fonboarding`
    : legacyGoogleEnabled
      ? "/auth/google?next=%2Fonboarding"
      : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="fixed right-4 top-4 z-10 flex items-center gap-2">
        <LocaleSelector />
        <ThemeToggle />
      </div>
      <LoginForm
        legacyGoogleEnabled={legacyGoogleEnabled}
        oauthOnly={oauth.oauthOnly}
        oauthProviders={providers}
      />
      <LoginApplicationPrompt applicationUrl={applicationUrl} />
    </main>
  );
}
