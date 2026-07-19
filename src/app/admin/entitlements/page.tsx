import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { featureLabel } from "@/lib/billing-labels";

export default async function AdminEntitlementsPage() {
  const { versions } = await getAdminPlanCatalog();
  const currentVersions = newestVersions(versions);
  const features = [...new Set(currentVersions.flatMap((version) => version.entitlements.map((item) => item.featureCode)))].sort();
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8"><header><h1 className="text-3xl font-semibold">功能權益矩陣</h1><p className="mt-2 text-sm text-stone-600">應用程式以權益代碼判斷功能，不以方案名稱寫死授權。</p><AdminCatalogNavigation /></header><div className="mt-6 overflow-x-auto border-y border-stone-200"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-stone-50"><tr><th className="sticky left-0 bg-stone-50 px-3 py-3">功能</th>{currentVersions.map((version) => <th key={version.id} className="px-3 py-3 text-center">{version.displayName} v{version.version}</th>)}</tr></thead><tbody className="divide-y divide-stone-200">{features.map((feature) => <tr key={feature}><td className="sticky left-0 bg-white px-3 py-3"><strong>{featureLabel(feature)}</strong><div className="text-xs text-stone-500">{feature}</div></td>{currentVersions.map((version) => { const entitlement = version.entitlements.find((item) => item.featureCode === feature); return <td key={version.id} className="px-3 py-3 text-center">{entitlement?.isEnabled ? entitlement.limitValue ?? "啟用" : "-"}</td>; })}</tr>)}</tbody></table></div></main>;
}
function newestVersions<T extends { planId: string; version: number }>(versions: T[]) { const map = new Map<string, T>(); for (const version of versions) if (!map.has(version.planId) || (map.get(version.planId)?.version ?? 0) < version.version) map.set(version.planId, version); return [...map.values()].sort((a, b) => a.version - b.version); }
