"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  APP_LOCALE_COOKIE,
  APP_LOCALE_COOKIE_MAX_AGE_SECONDS,
  isAppLocale,
  resolveNavigatorLocale,
  type AppLocale,
} from "@/lib/app-locale";
import { getAppMessage, type AppMessageKey } from "@/lib/app-messages";

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: AppMessageKey, values?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const INITIAL_LOCALE_NEGOTIATION_KEY = "stallorder.locale.initialized";

export function LocaleProvider({
  initialLocale,
  hasLocaleCookie,
  children,
}: {
  initialLocale: AppLocale;
  hasLocaleCookie: boolean;
  children: ReactNode;
}) {
  const [locale, setCurrentLocale] = useState(initialLocale);
  const initialNegotiationStarted = useRef(false);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    if (!isAppLocale(nextLocale)) return;
    writeLocaleCookie(nextLocale);
    setCurrentLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    window.location.reload();
  }, []);

  useEffect(() => {
    const languages = navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
    const negotiatedLocale = planInitialLocaleNegotiation(
      hasLocaleCookie,
      initialNegotiationStarted.current || hasInitialNegotiationMarker(),
      languages,
    );
    if (!negotiatedLocale) return;
    initialNegotiationStarted.current = true;
    markInitialNegotiationStarted();
    writeLocaleCookie(negotiatedLocale);
    if (shouldReloadForInitialLocale(initialLocale, negotiatedLocale)) {
      window.location.reload();
    }
  }, [hasLocaleCookie, initialLocale]);

  const t = useCallback(
    (key: AppMessageKey, values?: Record<string, string | number>) => (
      getAppMessage(locale, key, values)
    ),
    [locale],
  );
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useAppLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useAppLocale must be used within LocaleProvider");
  return value;
}

export function serializeLocaleCookie(locale: AppLocale, secure: boolean) {
  return [
    `${APP_LOCALE_COOKIE}=${encodeURIComponent(locale)}`,
    "Path=/",
    `Max-Age=${APP_LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function planInitialLocaleNegotiation(
  hasLocaleCookie: boolean,
  alreadyStarted: boolean,
  languages: readonly string[],
) {
  if (hasLocaleCookie || alreadyStarted) return null;
  return resolveNavigatorLocale(languages);
}

export function shouldReloadForInitialLocale(
  initialLocale: AppLocale,
  negotiatedLocale: AppLocale,
) {
  return initialLocale !== negotiatedLocale;
}

function writeLocaleCookie(locale: AppLocale) {
  document.cookie = serializeLocaleCookie(locale, window.location.protocol === "https:");
}

function hasInitialNegotiationMarker() {
  try {
    return window.sessionStorage.getItem(INITIAL_LOCALE_NEGOTIATION_KEY) === "1";
  } catch {
    return false;
  }
}

function markInitialNegotiationStarted() {
  try {
    window.sessionStorage.setItem(INITIAL_LOCALE_NEGOTIATION_KEY, "1");
  } catch {
    // The in-memory guard still prevents duplicate effects before navigation.
  }
}
