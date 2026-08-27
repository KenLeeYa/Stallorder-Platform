"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { useAppLocale } from "@/components/locale-provider";
import { interpolateMessage, type MessageValues } from "@/lib/message-catalog";
import type { MerchantMessageKey } from "@/lib/messages/merchant";

type MerchantMessageDictionary = Record<MerchantMessageKey, string>;

const MerchantMessagesContext = createContext<MerchantMessageDictionary | null>(null);

export function MerchantMessagesProvider({
  messages,
  children,
}: {
  messages: MerchantMessageDictionary;
  children: ReactNode;
}) {
  return createElement(MerchantMessagesContext.Provider, { value: messages }, children);
}

export function useMerchantMessages() {
  const { locale } = useAppLocale();
  const messages = useContext(MerchantMessagesContext);
  if (!messages) throw new Error("useMerchantMessages must be used within MerchantMessagesProvider");
  const m = useCallback(
    (key: MerchantMessageKey, values?: MessageValues) => (
      interpolateMessage(messages[key], values)
    ),
    [messages],
  );

  const label = useCallback(
    (value: string) => Object.prototype.hasOwnProperty.call(messages, value)
      ? messages[value as MerchantMessageKey]
      : value,
    [messages],
  );

  return { locale, m, label };
}
