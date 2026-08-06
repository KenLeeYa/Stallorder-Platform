import { LoginForm } from "@/components/login-form";
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
  const legacyGoogleEnabled = !oauth.oauthOnly
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
      <div className="fixed right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <LoginForm
        legacyGoogleEnabled={legacyGoogleEnabled}
        oauthOnly={oauth.oauthOnly}
        oauthProviders={providers}
      />
      <div className="mt-5 max-w-md text-center text-sm text-stone-600">
        <p>
          還沒有商家帳號？{" "}
          {applicationUrl ? (
            <a href={applicationUrl} className="font-semibold text-teal-800">
              使用已驗證帳號申請開通
            </a>
          ) : (
            <span className="font-semibold text-stone-500">申請開通暫時無法使用</span>
          )}
        </p>
        <p className="mt-2 text-xs text-stone-500">
          申請開通需具備已驗證的聯絡電子郵件；已受邀成為店員或廚房人員請直接登入。
        </p>
      </div>
    </main>
  );
}
