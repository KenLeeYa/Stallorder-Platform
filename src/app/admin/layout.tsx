import { AdminBillingHeader } from "@/components/admin-billing-header";
import { requirePlatformAdminPage } from "@/lib/authorization";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePlatformAdminPage();
  return <><AdminBillingHeader displayName={principal.user.displayName} />{children}</>;
}
