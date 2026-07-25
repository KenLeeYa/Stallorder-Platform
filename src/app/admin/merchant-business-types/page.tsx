import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { MerchantBusinessTypeOptionManager } from "@/components/merchant-business-type-option-manager";
import { listMerchantBusinessTypeOptionsForAdmin } from "@/server/merchant-applications/business-type-option-service";

export default async function AdminMerchantBusinessTypesPage() {
  const options = (await listMerchantBusinessTypeOptionsForAdmin()).map((option) => ({
    id: option.id,
    code: option.code,
    legacyType: option.legacyType ?? "OTHER",
    name: option.name,
    description: option.description,
    sortOrder: option.sortOrder,
    isActive: option.isActive,
    archivedAt: option.archivedAt?.toISOString() ?? null,
  }));
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">營業類型管理</h1>
        <p className="mt-2 text-sm text-stone-600">管理商家申請表的營業類型顯示與啟用狀態；歷史申請會保留原始資料。</p>
        <AdminCatalogNavigation />
      </header>
      <div className="mt-6">
        <MerchantBusinessTypeOptionManager initialOptions={options} />
      </div>
    </main>
  );
}
