import { AdminBillingHeader } from "@/components/admin-billing-header";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { getAdminModuleVisibility } from "@/server/admin/admin-module-visibility";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePlatformAdminPage();
  const moduleVisibility = await getAdminModuleVisibility();
  return <><AdminBillingHeader displayName={principal.user.displayName} moduleVisibility={moduleVisibility} />{children}</>;
}
