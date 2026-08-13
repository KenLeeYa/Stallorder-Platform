import "server-only";

import { cookies, headers } from "next/headers";
import {
  APP_LOCALE_COOKIE,
  isAppLocale,
  resolveAppLocale,
  type AppLocale,
} from "@/lib/app-locale";

export type RequestAppLocale = {
  locale: AppLocale;
  hasLocaleCookie: boolean;
};

export async function getRequestAppLocale(): Promise<RequestAppLocale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = cookieStore.get(APP_LOCALE_COOKIE)?.value;
  return {
    locale: resolveAppLocale(cookieLocale, headerStore.get("accept-language")),
    hasLocaleCookie: isAppLocale(cookieLocale),
  };
}
