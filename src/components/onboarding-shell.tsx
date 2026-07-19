import Link from "next/link";
import type { ReactNode } from "react";

export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto mb-5 max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-teal-800">
          返回 StallOrder
        </Link>
      </div>
      {children}
    </main>
  );
}
