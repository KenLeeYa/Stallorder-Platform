import { LoginForm } from "@/components/login-form";
import { isSupabaseAuthConfigured } from "@/lib/supabase-auth";

export default function LoginPage() {
  const googleEnabled = isSupabaseAuthConfigured();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <LoginForm googleEnabled={googleEnabled} />
      <div className="mt-5 max-w-md text-center text-sm text-stone-600">
        <p>
          還沒有商家帳號？{" "}
          {googleEnabled ? (
            <a href="/auth/google?next=%2Fonboarding" className="font-semibold text-teal-800">
              使用 Google 申請開通
            </a>
          ) : (
            <span className="font-semibold text-stone-500">申請開通暫時無法使用</span>
          )}
        </p>
        <p className="mt-2 text-xs text-stone-500">
          申請開通需先驗證 Google 電子郵件；已受邀成為店員或廚房人員請直接登入。
        </p>
      </div>
    </main>
  );
}
