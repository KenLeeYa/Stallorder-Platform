"use client";

import Link from "next/link";
import { Boxes, History, ListChecks, Puzzle } from "lucide-react";
import type { AdminMessageKey } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

const links = [
  ["/admin/plans", "Plans", Boxes],
  ["/admin/plan-versions", "Plan versions", History],
  ["/admin/entitlements", "Plan entitlements", ListChecks],
  ["/admin/add-ons", "Add-on catalog", Puzzle],
] as const satisfies ReadonlyArray<readonly [string, AdminMessageKey, typeof Boxes]>;

export function AdminCatalogNavigation() {
  const { m } = useAdminLocale();

  return (
    <nav aria-label={m("Platform catalog administration")} className="mt-5 flex gap-1 overflow-x-auto border-b border-stone-200">
      {links.map(([href, label, Icon]) => {
        const translatedLabel = m(label);
        return (
          <Link key={href} href={href} title={translatedLabel} aria-label={translatedLabel} className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 sm:w-auto sm:px-3">
            <Icon aria-hidden="true" className="h-5 w-5 text-teal-700 sm:h-4 sm:w-4" />
            <span className="sr-only sm:not-sr-only sm:inline">{translatedLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
