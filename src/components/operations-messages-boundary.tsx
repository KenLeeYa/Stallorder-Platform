import type { ReactNode } from "react";
import { OperationsMessagesProvider } from "@/components/operations-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getOperationsMessages } from "@/lib/messages/operations";

export async function OperationsMessagesBoundary({ children }: { children: ReactNode }) {
  const { locale } = await getRequestAppLocale();
  return (
    <OperationsMessagesProvider messages={getOperationsMessages(locale)}>
      {children}
    </OperationsMessagesProvider>
  );
}
