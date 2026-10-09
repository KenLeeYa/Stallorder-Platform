import { OperationsMessagesProvider } from "@/components/operations-locale";
import { MerchantMessagesProvider } from "@/lib/messages/merchant-client";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getMerchantMessages } from "@/lib/messages/merchant";
import { getOperationsMessages } from "@/lib/messages/operations";
import Link from "next/link";
import { complianceEnabled } from "@/server/compliance/contracts";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getRequestAppLocale();
  return (
    <OperationsMessagesProvider messages={getOperationsMessages(locale)}>
      <MerchantMessagesProvider messages={getMerchantMessages(locale)}>
        {complianceEnabled() && <nav aria-label="隱私權服務" className="px-4 text-right"><Link href="/merchant/privacy" className="inline-flex min-h-11 items-center underline">{locale === "en" ? "Privacy and data requests" : "隱私權與資料請求"}</Link></nav>}
        {children}
      </MerchantMessagesProvider>
    </OperationsMessagesProvider>
  );
}
