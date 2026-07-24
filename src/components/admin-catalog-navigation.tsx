import Link from "next/link";

const links = [
  ["/admin/plans", "方案"],
  ["/admin/plan-versions", "方案版本"],
  ["/admin/entitlements", "方案權益"],
  ["/admin/add-ons", "加購目錄"],
  ["/admin/merchant-business-types", "營業類型"],
] as const;

export function AdminCatalogNavigation() {
  return (
    <nav aria-label="平台目錄管理" className="mt-5 flex gap-1 overflow-x-auto border-b border-stone-200">
      {links.map(([href, label]) => <Link key={href} href={href} className="shrink-0 px-3 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">{label}</Link>)}
    </nav>
  );
}
