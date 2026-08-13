"use client";

import { useMemo } from "react";
import { useAppLocale } from "@/components/locale-provider";
import { createOperationsTranslator } from "@/lib/messages/operations";

export function useOperationsLocale() {
  const { locale } = useAppLocale();
  const t = useMemo(() => createOperationsTranslator(locale), [locale]);
  return { locale, t };
}
