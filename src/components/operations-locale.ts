"use client";

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useAppLocale } from "@/components/locale-provider";
import { interpolateMessage, type MessageValues } from "@/lib/message-catalog";
import type { OperationsMessageKey } from "@/lib/messages/operations";

type OperationsMessageDictionary = Record<OperationsMessageKey, string>;

const OperationsMessagesContext = createContext<OperationsMessageDictionary | null>(null);

export function OperationsMessagesProvider({
  messages,
  children,
}: {
  messages: OperationsMessageDictionary;
  children: ReactNode;
}) {
  return createElement(OperationsMessagesContext.Provider, { value: messages }, children);
}

export function useOperationsLocale() {
  const { locale } = useAppLocale();
  const messages = useContext(OperationsMessagesContext);
  if (!messages) throw new Error("useOperationsLocale must be used within OperationsMessagesProvider");
  const t = useMemo(() => (
    (key: OperationsMessageKey, values: MessageValues = {}) => (
      interpolateMessage(messages[key], values)
    )
  ), [messages]);
  return { locale, t };
}
