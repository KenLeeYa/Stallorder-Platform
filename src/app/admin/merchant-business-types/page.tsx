import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { MerchantBusinessTypeOptionManager } from "@/components/merchant-business-type-option-manager";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { createAdminTranslator } from "@/lib/messages/admin";
import { listMerchantBusinessTypeOptionsForAdmin } from "@/server/merchant-applications/business-type-option-service";

export default async function AdminMerchantBusinessTypesPage() {
  const [{ locale }, businessTypeOptions] = await Promise.all([getRequestAppLocale(), listMerchantBusinessTypeOptionsForAdmin()]);
  const m = createAdminTranslator(locale);
  const options = businessTypeOptions.map((option) => ({
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
        <h1 className="text-3xl font-semibold">{m("Business type management")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("Manage business types shown on merchant applications. Historical applications keep their original data.")}</p>
        <AdminCatalogNavigation />
      </header>
      <div className="mt-6">
        <MerchantBusinessTypeOptionManager initialOptions={options} />
      </div>
    </main>
  );
}
