import "server-only";

import type { CatalogTranslationProvider } from "@/server/localization/catalog-translation-contract";
import {
  AzureCatalogTranslationProvider,
  getAzureCatalogTranslationProviderLabel,
  isAzureCatalogTranslationConfigured,
} from "@/server/localization/azure-catalog-translation-provider";
import {
  getCatalogAiTranslationProviderLabel,
  isCatalogAiTranslationConfigured,
  OpenAiCatalogTranslationProvider,
  resolveCatalogAiTranslationRequestCredential,
} from "@/server/localization/openai-catalog-translation-provider";

export {
  CatalogTranslationConfigurationError,
  CatalogTranslationProviderError,
  type CatalogTranslationUpstreamFailure,
} from "@/server/localization/openai-catalog-translation-provider";

export async function resolveCatalogTranslationRequestCredential() {
  if (process.env.AI_TRANSLATION_PROVIDER?.trim() !== "vercel-ai-gateway") return undefined;
  return resolveCatalogAiTranslationRequestCredential();
}

export function isCatalogTranslationConfigured(requestCredential?: string) {
  return selectedProvider() === "azure-translator"
    ? isAzureCatalogTranslationConfigured()
    : isCatalogAiTranslationConfigured(requestCredential);
}

export function getCatalogTranslationProviderLabel(requestCredential?: string) {
  return selectedProvider() === "azure-translator"
    ? getAzureCatalogTranslationProviderLabel()
    : getCatalogAiTranslationProviderLabel(requestCredential);
}

export function createCatalogTranslationProvider(
  requestCredential?: string,
): CatalogTranslationProvider {
  return selectedProvider() === "azure-translator"
    ? new AzureCatalogTranslationProvider()
    : new OpenAiCatalogTranslationProvider(requestCredential);
}

function selectedProvider() {
  return process.env.AI_TRANSLATION_PROVIDER?.trim() || "openai";
}
