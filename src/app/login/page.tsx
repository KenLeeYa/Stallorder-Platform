import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { isGoogleLoginEnabled } from "@/lib/supabase-auth";

export default function LoginPage() {
  const googleEnabled = isGoogleLoginEnabled();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <LoginForm googleEnabled={googleEnabled} />
      <p className="mt-5 text-sm text-stone-600">
        尚未建立商戶？{" "}
        <Link href="/onboarding" className="font-semibold text-teal-800">開始申請</Link>
      </p>
    </main>
  );
}
