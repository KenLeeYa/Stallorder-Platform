import Link from "next/link";
import type { ReactNode } from "react";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { publicMessages } from "@/lib/messages/public";

export async function OnboardingShell({ children }: { children: ReactNode }) {
  const { locale } = await getRequestAppLocale();
  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto mb-5 max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-teal-800">
          {publicMessages.get(locale, "onboardingBackHome")}
        </Link>
      </div>
      {children}
    </main>
  );
}
