import Link from "next/link";
import { BadgeDollarSign, ChartNoAxesCombined, CreditCard, FileText, Layers3, PackageCheck } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";

const items = [
  { href: "/admin/billing", label: "帳務總覽", icon: BadgeDollarSign },
  { href: "/admin/subscriptions", label: "訂閱", icon: CreditCard },
  { href: "/admin/invoices", label: "帳單", icon: FileText },
  { href: "/admin/payments", label: "付款審核", icon: PackageCheck },
  { href: "/admin/plans", label: "方案目錄", icon: Layers3 },
  { href: "/admin/usage", label: "用量", icon: ChartNoAxesCombined },
] as const;

export function AdminBillingHeader({ displayName }: { displayName: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:px-8">
        <Link href="/admin/billing" className="mr-auto font-semibold text-stone-950">攤點通平台管理</Link>
        <nav aria-label="平台帳務管理" className="order-3 flex w-full gap-1 overflow-x-auto lg:order-none lg:w-auto">
          {items.map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"><Icon className="h-4 w-4 text-teal-700" />{item.label}</Link>;
          })}
        </nav>
        <span className="hidden max-w-36 truncate text-sm text-stone-600 sm:inline">{displayName}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
