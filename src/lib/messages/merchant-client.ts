"use client";

import { useCallback } from "react";
import { useAppLocale } from "@/components/locale-provider";
import type { MessageValues } from "@/lib/message-catalog";
import {
  getMerchantMessage,
  translateMerchantLabel,
  type MerchantMessageKey,
} from "@/lib/messages/merchant";

export function useMerchantMessages() {
  const { locale } = useAppLocale();
  const m = useCallback(
    (key: MerchantMessageKey, values?: MessageValues) => (
      getMerchantMessage(locale, key, values)
    ),
    [locale],
  );

  const label = useCallback(
    (value: string) => translateMerchantLabel(locale, value),
    [locale],
  );

  return { locale, m, label };
}
