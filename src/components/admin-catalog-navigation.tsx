import Link from "next/link";

const links = [
  ["/admin/plans", "方案"],
  ["/admin/plan-versions", "方案版本"],
  ["/admin/entitlements", "功能權益"],
  ["/admin/add-ons", "加購目錄"],
] as const;

export function AdminCatalogNavigation() {
  return <nav aria-label="商業方案目錄" className="mt-5 flex gap-1 overflow-x-auto border-b border-stone-200">{links.map(([href, label]) => <Link key={href} href={href} className="shrink-0 px-3 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">{label}</Link>)}</nav>;
}
