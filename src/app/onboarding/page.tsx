import Link from "next/link";
import { OnboardingForm } from "@/components/onboarding-form";
import { getPagePrincipal } from "@/lib/auth";

export default async function OnboardingPage() {
  const principal = await getPagePrincipal();
  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto mb-5 max-w-2xl">
        <Link href="/" className="text-sm font-semibold text-teal-800">
          返回 StallOrder
        </Link>
      </div>
      <OnboardingForm authenticatedProfile={principal ? { displayName: principal.user.displayName, email: principal.user.email } : undefined} />
    </main>
  );
}
