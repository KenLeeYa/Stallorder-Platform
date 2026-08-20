"use client";

import Link from "next/link";
import type { AdminMessageKey } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

const links = [
  ["/admin/plans", "Plans"],
  ["/admin/plan-versions", "Plan versions"],
  ["/admin/entitlements", "Plan entitlements"],
  ["/admin/add-ons", "Add-on catalog"],
  ["/admin/merchant-business-types", "Business types"],
] as const satisfies ReadonlyArray<readonly [string, AdminMessageKey]>;

export function AdminCatalogNavigation() {
  const { m } = useAdminLocale();

  return (
    <nav aria-label={m("Platform catalog administration")} className="mt-5 flex gap-1 overflow-x-auto border-b border-stone-200">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="shrink-0 px-3 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
          {m(label)}
        </Link>
      ))}
    </nav>
  );
}
