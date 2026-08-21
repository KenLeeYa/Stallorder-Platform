import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TranslationLocale } from "@/lib/enabled-locales";
import {
  catalogTranslationOutputSchema,
  getProtectedTranslationTokens,
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
const NUMBER_TOKEN_PATTERN = /[+\-−±]?\p{N}+(?:[.,]\p{N}+)*/gu;
const LATIN_OR_NUMBER_CHAR = /[\p{Script=Latin}\p{N}]/u;
const TOKEN_JOINER_CHAR = /[&＆'’+._/\-\u2010-\u2015－]/u;
const HAN_NUMBER_SEQUENCE_PATTERN = /[〇零一二兩三四五六七八九十百千萬]+/gu;
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
      url.searchParams.set("textType", "html");
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
        body: JSON.stringify(fields.map((field) => ({ Text: buildProtectedHtml(field.source) }))),
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
        items[field.itemIndex][field.field] = normalizeLocaleNumbers(
          field.source,
          decodeTranslatedHtml(translated.text),
          request.locale,
        );
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

function buildProtectedHtml(source: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;

  for (const token of getProtectedTranslationTokens(source)) {
    const start = source.indexOf(token, searchFrom);
    if (start === -1) continue;
    ranges.push({ start, end: start + token.length });
    searchFrom = start + token.length;
  }
  for (const match of source.matchAll(NUMBER_TOKEN_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!ranges.some((range) => start < range.end && end > range.start)) {
      ranges.push({ start, end });
    }
  }
  ranges.sort((left, right) => left.start - right.start);

  let html = "<div>";
  let sourceIndex = 0;
  for (const range of ranges) {
    html += escapeHtml(source.slice(sourceIndex, range.start));
    html += `<span class="notranslate">${escapeHtml(source.slice(range.start, range.end))}</span>`;
    sourceIndex = range.end;
  }
  return `${html}${escapeHtml(source.slice(sourceIndex))}</div>`;
}

function decodeTranslatedHtml(value: string) {
  const trimmed = value.trim();
  const wrapper = trimmed.match(/^<div(?:\s[^>]*)?>([\s\S]*)<\/div>$/iu);
  if (!wrapper) {
    if (/<\/?[A-Za-z][^>]*>/u.test(trimmed)) {
      throw new CatalogTranslationProviderError("翻譯供應器回傳無效結果。");
    }
    return decodeHtmlEntities(trimmed);
  }
  const text = stripNotranslateSpans(wrapper[1]);
  if (/<\/?[A-Za-z][^>]*>/u.test(text)) {
    throw new CatalogTranslationProviderError("翻譯供應器回傳無效結果。");
  }
  return decodeHtmlEntities(text).trim();
}

function stripNotranslateSpans(value: string) {
  const spanPattern = /<span\s+class=(?:"notranslate"|'notranslate'|notranslate)\s*>([\s\S]*?)<\/span>/giu;
  let text = "";
  let sourceIndex = 0;
  for (const match of value.matchAll(spanPattern)) {
    const matchIndex = match.index;
    const content = match[1];
    text += value.slice(sourceIndex, matchIndex);
    const previous = text.at(-1);
    const beforePrevious = text.at(-2);
    if (
      content
      && previous
      && (
        LATIN_OR_NUMBER_CHAR.test(previous)
        || Boolean(beforePrevious && TOKEN_JOINER_CHAR.test(previous) && LATIN_OR_NUMBER_CHAR.test(beforePrevious))
      )
    ) {
      text += " ";
    }
    text += content;
    const nextIndex = matchIndex + match[0].length;
    const next = value[nextIndex];
    const afterNext = value[nextIndex + 1];
    if (
      content
      && next
      && (
        LATIN_OR_NUMBER_CHAR.test(next)
        || Boolean(afterNext && TOKEN_JOINER_CHAR.test(next) && LATIN_OR_NUMBER_CHAR.test(afterNext))
      )
    ) {
      text += " ";
    }
    sourceIndex = nextIndex;
  }
  return text + value.slice(sourceIndex);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/giu, "\"")
    .replace(/&#(?:39|x27);/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function normalizeLocaleNumbers(source: string, translated: string, locale: TranslationLocale) {
  if (locale !== "ja") return translated;
  const sourceNumbers = source.normalize("NFKC").match(NUMBER_TOKEN_PATTERN) ?? [];
  const semanticNumbers = new Map<string, number>();
  for (const match of source.matchAll(HAN_NUMBER_SEQUENCE_PATTERN)) {
    const value = parseHanNumber(match[0]);
    if (value === null) continue;
    const key = String(value);
    semanticNumbers.set(key, (semanticNumbers.get(key) ?? 0) + 1);
  }

  let sourceNumberIndex = 0;
  return translated.replace(NUMBER_TOKEN_PATTERN, (token) => {
    const normalized = token.normalize("NFKC");
    if (normalized === sourceNumbers[sourceNumberIndex]) {
      sourceNumberIndex += 1;
      return token;
    }
    const remaining = semanticNumbers.get(normalized) ?? 0;
    if (remaining === 0) return token;
    const japaneseNumber = formatJapaneseNumber(normalized);
    if (!japaneseNumber) return token;
    semanticNumbers.set(normalized, remaining - 1);
    return japaneseNumber;
  });
}

function parseHanNumber(value: string) {
  const digit = new Map<string, number>([
    ["〇", 0], ["零", 0], ["一", 1], ["二", 2], ["兩", 2], ["三", 3], ["四", 4],
    ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9],
  ]);
  if (![...value].some((character) => "十百千萬".includes(character))) {
    const digits = [...value].map((character) => digit.get(character));
    if (digits.some((number) => number === undefined)) return null;
    return Number(digits.join(""));
  }

  const unit = new Map<string, number>([["十", 10], ["百", 100], ["千", 1_000]]);
  let total = 0;
  let section = 0;
  let currentDigit = 0;
  for (const character of value) {
    const numeric = digit.get(character);
    if (numeric !== undefined) {
      currentDigit = numeric;
      continue;
    }
    if (character === "萬") {
      total += (section + currentDigit) * 10_000;
      section = 0;
      currentDigit = 0;
      continue;
    }
    const multiplier = unit.get(character);
    if (!multiplier) return null;
    section += (currentDigit || 1) * multiplier;
    currentDigit = 0;
  }
  return total + section + currentDigit;
}

function formatJapaneseNumber(value: string) {
  if (!/^\d{1,4}$/u.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return null;
  if (numeric === 0) return "〇";
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = [
    { value: 1_000, suffix: "千" },
    { value: 100, suffix: "百" },
    { value: 10, suffix: "十" },
  ];
  let remainder = numeric;
  let result = "";
  for (const unit of units) {
    const count = Math.floor(remainder / unit.value);
    if (count > 0) result += `${count === 1 ? "" : digits[count]}${unit.suffix}`;
    remainder %= unit.value;
  }
  return result + digits[remainder];
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
