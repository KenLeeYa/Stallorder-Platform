import { AdminBillingHeader } from "@/components/admin-billing-header";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { MerchantMessagesProvider } from "@/lib/messages/merchant-client";
import { getMerchantMessages } from "@/lib/messages/merchant";
import { getAdminModuleVisibility } from "@/server/admin/admin-module-visibility";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [{ locale }, principal, moduleVisibility] = await Promise.all([
    getRequestAppLocale(),
    requirePlatformAdminPage(),
    getAdminModuleVisibility(),
  ]);
  return (
    <MerchantMessagesProvider messages={getMerchantMessages(locale)}>
      <AdminBillingHeader displayName={principal.user.displayName} moduleVisibility={moduleVisibility} />
      {children}
    </MerchantMessagesProvider>
  );
}
