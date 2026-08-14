"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAppLocale } from "@/components/locale-provider";
import { publicMessages } from "@/lib/messages/public";

export function OnboardingShell({ children }: { children: ReactNode }) {
  const { locale } = useAppLocale();
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
