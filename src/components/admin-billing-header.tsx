"use client";

import Link from "next/link";
import { WorkspaceFunctionNavigation, type WorkspaceFunction } from "@/components/workspace-function-navigation";
import {
  Activity,
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
  { href: "/admin/health", label: "System health", icon: Activity },
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
  const { m, locale } = useAdminLocale();
  const navigation: WorkspaceFunction[] = items.filter(item => !item.module || moduleVisibility[item.module]).map(item => ({
    ...item, label: m(item.label),
    primary: ["/admin/billing", "/admin/health", "/admin/merchant-applications", "/admin/subscriptions"].includes(item.href),
    group: ["/admin/health", "/admin/usage"].includes(item.href) ? "operations"
      : ["/admin/merchant-applications", "/admin/merchant-business-types"].includes(item.href) ? "merchants"
      : item.href === "/admin/login-methods" ? "audit"
      : item.href.includes("integrations") || item.href === "/admin/e-invoice" ? "settings" : "finance",
  }));

  return (
    <>
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
        <div className="mt-2 xl:hidden"><WorkspaceFunctionNavigation items={navigation} locale={locale} label={m("Platform administration navigation")} testId="admin-function-navigation" /></div>
      </div>
    </header>
    <aside className="fixed bottom-0 left-0 top-[4.5rem] z-20 hidden w-60 overflow-y-auto border-r border-stone-200 bg-white p-4 xl:block">
      <WorkspaceFunctionNavigation items={navigation} locale={locale} label={m("Platform administration navigation")} testId="admin-function-sidebar" sidebar />
    </aside>
    </>
  );
}
