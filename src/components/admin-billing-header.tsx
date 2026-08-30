"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  FileText,
  KeyRound,
  Layers3,
  PackageCheck,
  ReceiptText,
  Store,
  Truck,
  WalletCards,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AdminMessageKey } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

type AdminNavigationItem = {
  href: string;
  label: AdminMessageKey;
  icon: typeof Store;
  module?: "delivery" | "payments";
};

const items: ReadonlyArray<AdminNavigationItem> = [
  { href: "/admin/merchant-applications", label: "Merchant applications", icon: ClipboardList },
  { href: "/admin/billing", label: "Billing overview", icon: BadgeDollarSign },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/payments", label: "Payment review", icon: PackageCheck, module: "payments" },
  { href: "/admin/merchant-business-types", label: "Business types", icon: Store },
  { href: "/admin/plans", label: "Plan catalog", icon: Layers3 },
  { href: "/admin/usage", label: "Usage", icon: ChartNoAxesCombined },
  { href: "/admin/delivery-integrations", label: "Delivery integrations", icon: Truck, module: "delivery" },
  { href: "/admin/login-methods", label: "Login methods", icon: KeyRound },
  { href: "/admin/payment-integrations", label: "Payment integrations", icon: WalletCards, module: "payments" },
  { href: "/admin/e-invoice", label: "Electronic invoice integrations", icon: ReceiptText },
];

export function AdminBillingHeader({ displayName, moduleVisibility = { delivery: false, payments: false } }: {
  displayName: string;
  moduleVisibility?: { delivery: boolean; payments: boolean };
}) {
  const { m } = useAdminLocale();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 overflow-x-hidden border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/admin/billing" className="mr-auto min-w-0 truncate font-semibold text-stone-950">
            {m("Platform administration")}
          </Link>
          <span className="max-w-20 truncate text-xs text-stone-600 sm:max-w-32 sm:text-sm">{displayName}</span>
          <ThemeToggle />
          <LogoutButton />
        </div>
        <nav
          aria-label={m("Platform administration navigation")}
          className="mt-2 flex min-w-0 max-w-full gap-1 overflow-x-auto pb-0.5"
        >
          {items.filter((item) => !item.module || moduleVisibility[item.module]).map((item) => {
            const Icon = item.icon;
            const label = m(item.label);
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={label}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors md:w-auto md:px-3 ${isActive ? "bg-teal-50 text-teal-900" : "text-stone-700 hover:bg-stone-100"}`}
              >
                <Icon aria-hidden="true" className="h-5 w-5 text-teal-700 md:h-4 md:w-4" />
                <span className="sr-only md:not-sr-only md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
