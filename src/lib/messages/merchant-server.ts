import "server-only";

import { getRequestAppLocale } from "@/lib/app-locale-server";
import type { MessageValues } from "@/lib/message-catalog";
import {
  getMerchantMessage,
  translateMerchantLabel,
  type MerchantMessageKey,
} from "@/lib/messages/merchant";

export async function getRequestMerchantMessages() {
  const { locale } = await getRequestAppLocale();
  return {
    locale,
    m: (key: MerchantMessageKey, values?: MessageValues) => (
      getMerchantMessage(locale, key, values)
    ),
    label: (value: string) => translateMerchantLabel(locale, value),
  };
}
