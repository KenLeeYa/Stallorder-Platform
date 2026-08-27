import type { ReactNode } from "react";
import { LocaleProvider } from "@/components/locale-provider";
import { OperationsMessagesProvider } from "@/components/operations-locale";
import type { AppLocale } from "@/lib/app-locale";
import { MerchantMessagesProvider } from "@/lib/messages/merchant-client";
import { getMerchantMessages } from "@/lib/messages/merchant";
import { getOperationsMessages } from "@/lib/messages/operations";

export function MessageTestProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children?: ReactNode;
}) {
  return (
    <LocaleProvider initialLocale={initialLocale} hasLocaleCookie>
      <MerchantMessagesProvider messages={getMerchantMessages(initialLocale)}>
        <OperationsMessagesProvider messages={getOperationsMessages(initialLocale)}>
          {children}
        </OperationsMessagesProvider>
      </MerchantMessagesProvider>
    </LocaleProvider>
  );
}
