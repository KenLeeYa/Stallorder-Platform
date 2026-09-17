import { headers } from "next/headers";
import { AdminBillingHeader } from "@/components/admin-billing-header";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { MerchantMessagesProvider } from "@/lib/messages/merchant-client";
import { getMerchantMessages } from "@/lib/messages/merchant";
import { getAdminModuleVisibility } from "@/server/admin/admin-module-visibility";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const returnPath = requestHeaders.get("x-stallorder-admin-return-path") === "/admin/health"
    ? "/admin/health"
    : "/admin/billing";
  const [{ locale }, principal, moduleVisibility] = await Promise.all([
    getRequestAppLocale(),
    requirePlatformAdminPage(returnPath),
    getAdminModuleVisibility(),
  ]);
  return (
    <MerchantMessagesProvider messages={getMerchantMessages(locale)}>
      <AdminBillingHeader displayName={principal.user.displayName} moduleVisibility={moduleVisibility} />
      {children}
    </MerchantMessagesProvider>
  );
}
