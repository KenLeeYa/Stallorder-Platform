import { OperationsMessagesProvider } from "@/components/operations-locale";
import { MerchantMessagesProvider } from "@/lib/messages/merchant-client";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getMerchantMessages } from "@/lib/messages/merchant";
import { getOperationsMessages } from "@/lib/messages/operations";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getRequestAppLocale();
  return (
    <OperationsMessagesProvider messages={getOperationsMessages(locale)}>
      <MerchantMessagesProvider messages={getMerchantMessages(locale)}>
        {children}
      </MerchantMessagesProvider>
    </OperationsMessagesProvider>
  );
}
