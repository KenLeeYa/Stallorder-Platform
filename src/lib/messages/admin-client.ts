"use client";

import { useMemo } from "react";
import { useAppLocale } from "@/components/locale-provider";
import { createAdminTranslator } from "@/lib/messages/admin";

export function useAdminLocale() {
  const { locale } = useAppLocale();
  const m = useMemo(() => createAdminTranslator(locale), [locale]);

  return { locale, m };
}
