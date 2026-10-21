"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, ReceiptText, CircleUserRound, CircleHelp } from "lucide-react";

const destinations = [
  { href: "/mini", label: "店家", icon: Store },
  { href: "/mini/orders", label: "我的訂單", icon: ReceiptText },
  { href: "/mini/member", label: "會員", icon: CircleUserRound },
  { href: "/mini/help", label: "協助", icon: CircleHelp },
];

export function LineMiniAppNavigation() {
  const pathname = usePathname();
  const store = pathname.startsWith("/mini/store/");
  return <nav aria-label="攤點通會員導覽" className="mini-navigation" data-store={store || undefined}>
    {destinations.map(({ href, label, icon: Icon }) => {
      const active = href === "/mini" ? pathname === href || store : pathname === href || pathname.startsWith(`${href}/`);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined}>
        <Icon aria-hidden="true" /><span>{label}</span>
      </Link>;
    })}
  </nav>;
}
