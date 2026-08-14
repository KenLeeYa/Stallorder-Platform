"use client";

import Link from "next/link";
import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  FileText,
  Layers3,
  PackageCheck,
  Store,
  Truck,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import type { AdminMessageKey } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

const items = [
  { href: "/admin/merchant-applications", label: "Merchant applications", icon: ClipboardList },
  { href: "/admin/billing", label: "Billing overview", icon: BadgeDollarSign },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/payments", label: "Payment review", icon: PackageCheck },
  { href: "/admin/merchant-business-types", label: "Business types", icon: Store },
  { href: "/admin/plans", label: "Plan catalog", icon: Layers3 },
  { href: "/admin/usage", label: "Usage", icon: ChartNoAxesCombined },
  { href: "/admin/delivery-integrations", label: "Delivery integrations", icon: Truck },
] as const satisfies ReadonlyArray<{ href: string; label: AdminMessageKey; icon: typeof Store }>;

export function AdminBillingHeader({ displayName }: { displayName: string }) {
  const { m } = useAdminLocale();

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:px-8">
        <Link href="/admin/billing" className="mr-auto font-semibold text-stone-950">
          {m("Platform administration")}
        </Link>
        <nav
          aria-label={m("Platform administration navigation")}
          className="order-3 flex w-full gap-1 overflow-x-auto lg:order-none lg:w-auto"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
              >
                <Icon className="h-4 w-4 text-teal-700" />
                {m(item.label)}
              </Link>
            );
          })}
        </nav>
        <span className="hidden max-w-36 truncate text-sm text-stone-600 sm:inline">{displayName}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
