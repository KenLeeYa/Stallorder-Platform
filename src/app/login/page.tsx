import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { isSupabaseAuthConfigured } from "@/lib/supabase-auth";

export default function LoginPage() {
  const googleEnabled = isSupabaseAuthConfigured();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <LoginForm googleEnabled={googleEnabled} />
      <div className="mt-5 max-w-md text-center text-sm text-stone-600">
        <p>還沒有商家帳號？<Link href="/onboarding" className="font-semibold text-teal-800">申請開通</Link></p>
        <p className="mt-2 text-xs text-stone-500">已受邀成為店員或廚房人員？請使用受邀的 Google 帳號登入</p>
      </div>
    </main>
  );
}
