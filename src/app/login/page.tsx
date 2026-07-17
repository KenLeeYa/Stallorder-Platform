import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { sanitizeRedirectPath } from "@/lib/security";
import { isSupabaseAuthConfigured } from "@/lib/supabase-auth";

type PageProps = { searchParams: Promise<{ next?: string; oauthError?: string }> };

export default async function LoginPage({ searchParams }: PageProps) {
  const { next, oauthError } = await searchParams;
  const nextPath = next ? sanitizeRedirectPath(next, "/") : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <LoginForm nextPath={nextPath} googleEnabled={isSupabaseAuthConfigured()} oauthError={oauthError} />
      <p className="mt-5 text-sm text-stone-600">
        尚未建立商戶？{" "}
        <Link href="/onboarding" className="font-semibold text-teal-800">開始申請</Link>
      </p>
    </main>
  );
}
