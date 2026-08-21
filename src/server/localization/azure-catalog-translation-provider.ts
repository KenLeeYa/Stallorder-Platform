import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TranslationLocale } from "@/lib/enabled-locales";
import {
  catalogTranslationOutputSchema,
  type CatalogTranslationProvider,
  type CatalogTranslationRequest,
} from "@/server/localization/catalog-translation-contract";
import { getCatalogGlossaryTranslation } from "@/server/localization/catalog-translation-glossary";
import {
  CatalogTranslationConfigurationError,
  CatalogTranslationProviderError,
  type CatalogTranslationUpstreamFailure,
} from "@/server/localization/openai-catalog-translation-provider";
import { isCatalogTranslationEnabled } from "@/server/localization/catalog-translation-settings";

const AZURE_TRANSLATOR_ENDPOINT = "https://api.cognitive.microsofttranslator.com/translate";
const AZURE_TRANSLATOR_TIMEOUT_MS = 20_000;
const REGION_PATTERN = /^[a-z0-9-]{1,64}$/;
const azureLocale: Record<TranslationLocale, string> = {
  en: "en",
  ja: "ja",
  ko: "ko",
  vi: "vi",
  th: "th",
};

const azureTranslationResponseSchema = z.array(z.object({
  translations: z.array(z.object({
    text: z.string(),
    to: z.string(),
  })).min(1),
}));

type TranslationField = {
  itemIndex: number;
  field: "name" | "description";
  source: string;
};

class AzureTranslatorHttpError extends Error {
  constructor(readonly status: number) {
    super("Azure Translator request failed.");
  }
}

export function isAzureCatalogTranslationConfigured() {
  return isCatalogTranslationEnabled() && Boolean(readConfiguration());
}

export function getAzureCatalogTranslationProviderLabel() {
  return isAzureCatalogTranslationConfigured() ? "Azure Translator" : null;
}

export class AzureCatalogTranslationProvider implements CatalogTranslationProvider {
  constructor(private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

  async translate(request: CatalogTranslationRequest) {
    const configuration = getConfiguration();
    const targetLocale = azureLocale[request.locale];
    const items = request.items.map((item) => ({
      key: item.key,
      name: null as string | null,
      description: null as string | null,
    }));
    const fields: TranslationField[] = [];

    request.items.forEach((item, itemIndex) => {
      if (item.needsName) {
        const glossaryName = getCatalogGlossaryTranslation(item.sourceName, request.locale);
        if (glossaryName) items[itemIndex].name = glossaryName;
        else fields.push({ itemIndex, field: "name", source: item.sourceName });
      }
      if (item.needsDescription) {
        if (!item.sourceDescription) {
          throw new CatalogTranslationProviderError("翻譯輸入缺少商品說明。");
        }
        const glossaryDescription = getCatalogGlossaryTranslation(item.sourceDescription, request.locale);
        if (glossaryDescription) items[itemIndex].description = glossaryDescription;
        else fields.push({ itemIndex, field: "description", source: item.sourceDescription });
      }
    });

    if (fields.length === 0) return catalogTranslationOutputSchema.parse({ items });

    try {
      const url = new URL(AZURE_TRANSLATOR_ENDPOINT);
      url.searchParams.set("api-version", "3.0");
      url.searchParams.set("from", "zh-Hant");
      url.searchParams.set("to", targetLocale);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": configuration.apiKey,
        "X-ClientTraceId": randomUUID(),
      };
      if (configuration.region) {
        headers["Ocp-Apim-Subscription-Region"] = configuration.region;
      }
      const response = await this.fetchImplementation(url, {
        method: "POST",
        headers,
        body: JSON.stringify(fields.map((field) => ({ Text: field.source }))),
        signal: AbortSignal.timeout(AZURE_TRANSLATOR_TIMEOUT_MS),
      });
      if (!response.ok) throw new AzureTranslatorHttpError(response.status);

      const parsed = azureTranslationResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.length !== fields.length) {
        throw new CatalogTranslationProviderError("翻譯供應器回傳無效結果。");
      }
      parsed.data.forEach((result, index) => {
        const translated = result.translations.find((translation) => translation.to === targetLocale);
        if (!translated?.text.trim()) {
          throw new CatalogTranslationProviderError("翻譯供應器回傳無效結果。");
        }
        const field = fields[index];
        items[field.itemIndex][field.field] = translated.text.trim();
      });
      return catalogTranslationOutputSchema.parse({ items });
    } catch (error) {
      if (error instanceof CatalogTranslationProviderError) throw error;
      throw new CatalogTranslationProviderError(
        "翻譯供應器暫時無法使用。",
        classifyUpstreamFailure(error),
      );
    }
  }
}

function classifyUpstreamFailure(error: unknown): CatalogTranslationUpstreamFailure {
  if (!(error instanceof AzureTranslatorHttpError)) return "UPSTREAM";
  if (error.status === 401) return "AUTHENTICATION";
  if (error.status === 403) return "PERMISSION_OR_VERIFICATION";
  if (error.status === 404) return "MODEL_OR_ROUTE";
  if (error.status === 429) return "RATE_LIMIT";
  return "UPSTREAM";
}

function getConfiguration() {
  if (!isCatalogTranslationEnabled()) {
    throw new CatalogTranslationConfigurationError("AI 翻譯尚未啟用。");
  }
  const configuration = readConfiguration();
  if (!configuration) {
    throw new CatalogTranslationConfigurationError("Azure Translator 設定不完整。");
  }
  return configuration;
}

function readConfiguration() {
  if (process.env.AI_TRANSLATION_PROVIDER?.trim() !== "azure-translator") return null;
  const apiKey = process.env.AZURE_TRANSLATOR_KEY?.trim();
  const region = process.env.AZURE_TRANSLATOR_REGION?.trim() || undefined;
  if (!apiKey || apiKey.length > 512 || /\s/u.test(apiKey)) return null;
  if (region && !REGION_PATTERN.test(region)) return null;
  return { apiKey, region };
}
