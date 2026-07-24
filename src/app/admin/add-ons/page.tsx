import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { formatMoney } from "@/lib/money";

export default async function AdminAddOnsPage() {
  const { addOns } = await getAdminPlanCatalog();
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8"><header><h1 className="text-3xl font-semibold">加購目錄</h1><p className="mt-2 text-sm text-stone-600">只有「啟用」或「需人工核准」項目可由平台加入帳單；即將推出項目不會開通。</p><AdminCatalogNavigation /></header><div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{addOns.map((item) => <article key={item.id} className="rounded-md border border-stone-200 p-5"><div className="flex justify-between gap-3"><h2 className="font-semibold">{item.displayName}</h2><span className="text-xs">{availability(item.availabilityStatus)}</span></div><p className="mt-2 text-sm text-stone-600">{item.description}</p><dl className="mt-4 space-y-2 text-sm"><Row label="代碼" value={item.code} /><Row label="計費類型" value={item.billingType} /><Row label="單價" value={formatMoney(item.unitPrice, item.currency)} /><Row label="權益" value={item.featureCode ?? "無"} /><Row label="人工核准" value={item.requiresManualApproval ? "需要" : "不需要"} /></dl></article>)}</div></main>;
}
function availability(value: string) { return ({ ENABLED: "啟用", MANUAL_APPROVAL_REQUIRED: "需人工核准", COMING_SOON: "即將推出" } as Record<string, string>)[value] ?? value; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><dt className="text-stone-500">{label}</dt><dd className="break-all text-right">{value}</dd></div>; }
