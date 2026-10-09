import "server-only";
import type { AppLocale } from "@/lib/app-locale";
import { getMerchantMessage } from "@/lib/messages/merchant";
import { createReportTranslator } from "@/lib/messages/reports";
import { authorityLabelKeys, readLabelKeys, catalogLabelKeys, historyLabelKeys, type AuthorityLabels, type ReadLabels, type CatalogLabels, type HistoryLabels } from "@/lib/operations-labels";

export function getOperationsAuthorityLabels(locale: AppLocale): AuthorityLabels { return Object.fromEntries(authorityLabelKeys.map(key => [key, getMerchantMessage(locale, key)])) as AuthorityLabels; }
export function getOperationsReadLabels(locale: AppLocale): ReadLabels { return Object.fromEntries(readLabelKeys.map(key => [key, getMerchantMessage(locale, key)])) as ReadLabels; }
export function getCatalogListLabels(locale: AppLocale): CatalogLabels { return Object.fromEntries(catalogLabelKeys.map(key => [key, getMerchantMessage(locale, key)])) as CatalogLabels; }
export function getHistoryListLabels(locale: AppLocale): HistoryLabels { const t = createReportTranslator(locale); return Object.fromEntries(historyLabelKeys.map(key => [key, t(key)])) as HistoryLabels; }
