import Link from "next/link";
import { OnboardingForm } from "@/components/onboarding-form";

export default function OnboardingPage() {
  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto mb-5 max-w-2xl">
        <Link href="/" className="text-sm font-semibold text-teal-800">
          返回 StallOrder
        </Link>
      </div>
      <OnboardingForm />
    </main>
  );
}
