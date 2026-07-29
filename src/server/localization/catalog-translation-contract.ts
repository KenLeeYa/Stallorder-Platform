import { z } from "zod";
import type { TranslationLocale } from "@/lib/enabled-locales";

export const catalogTranslationEntityTypes = ["PRODUCT", "NOTE_GROUP", "NOTE_OPTION"] as const;
export type CatalogTranslationEntityType = (typeof catalogTranslationEntityTypes)[number];

type ExistingTranslation = {
  locale: string;
  name: string;
  description?: string;
};

export type CatalogTranslationSource = {
  products: Array<{
    id: string;
    name: string;
    description: string;
    categoryName: string;
    groupName: string | null;
    translations: ExistingTranslation[];
  }>;
  noteGroups: Array<{
    id: string;
    name: string;
    translations: ExistingTranslation[];
    options: Array<{
      id: string;
      name: string;
      translations: ExistingTranslation[];
    }>;
  }>;
};

export type CatalogTranslationRequestItem = {
  key: string;
  entityType: CatalogTranslationEntityType;
  entityId: string;
  sourceName: string;
  sourceDescription: string | null;
  context: string | null;
  existingName: string | null;
  needsName: boolean;
  needsDescription: boolean;
};

export type CatalogTranslationRequest = {
  locale: TranslationLocale;
  items: CatalogTranslationRequestItem[];
};

export type CatalogTranslationOutput = z.infer<typeof catalogTranslationOutputSchema>;

export type ValidatedCatalogTranslation = {
  locale: TranslationLocale;
  entityType: CatalogTranslationEntityType;
  entityId: string;
  sourceName: string;
  sourceDescription: string | null;
  name: string | null;
  description: string | null;
};

export interface CatalogTranslationProvider {
  translate(request: CatalogTranslationRequest): Promise<CatalogTranslationOutput>;
}

const translatedName = z.string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\u0000-\u001f\u007f-\u009f]*$/);
const translatedDescription = z.string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]*$/);

export const catalogTranslationOutputSchema = z.object({
  items: z.array(z.object({
    key: z.string().min(1).max(20),
    name: translatedName.nullable(),
    description: translatedDescription.nullable(),
  }).strict()).max(100),
}).strict();

export class CatalogTranslationOutputError extends Error {
  readonly code = "INVALID_TRANSLATION_OUTPUT";
}

export function buildCatalogTranslationRequests(
  source: CatalogTranslationSource,
  locales: readonly TranslationLocale[],
): CatalogTranslationRequest[] {
  return locales.map((locale) => {
    let keyIndex = 0;
    const items: CatalogTranslationRequestItem[] = [];
    const addItem = (
      entityType: CatalogTranslationEntityType,
      entityId: string,
      sourceName: string,
      sourceDescription: string | null,
      context: string | null,
      translations: ExistingTranslation[],
    ) => {
      const existing = translations.find((translation) => translation.locale === locale);
      const needsName = !existing?.name.trim();
      const needsDescription = Boolean(sourceDescription?.trim()) && !existing?.description?.trim();
      if (!needsName && !needsDescription) return;
      items.push({
        key: `item-${keyIndex++}`,
        entityType,
        entityId,
        sourceName,
        sourceDescription,
        context,
        existingName: existing?.name.trim() || null,
        needsName,
        needsDescription,
      });
    };

    for (const product of source.products) {
      addItem(
        "PRODUCT",
        product.id,
        product.name,
        product.description.trim() || null,
        [product.categoryName, product.groupName].filter(Boolean).join(" / ") || null,
        product.translations,
      );
    }
    for (const group of source.noteGroups) {
      addItem("NOTE_GROUP", group.id, group.name, null, "商品客製化選項群組", group.translations);
      for (const option of group.options) {
        addItem("NOTE_OPTION", option.id, option.name, null, `註記群組：${group.name}`, option.translations);
      }
    }

    return { locale, items };
  }).filter((request) => request.items.length > 0);
}

export function validateCatalogTranslationOutput(
  request: CatalogTranslationRequest,
  output: CatalogTranslationOutput,
): ValidatedCatalogTranslation[] {
  const expected = new Map(request.items.map((item) => [item.key, item]));
  const received = new Map<string, CatalogTranslationOutput["items"][number]>();

  for (const item of output.items) {
    if (!expected.has(item.key) || received.has(item.key)) {
      throw new CatalogTranslationOutputError("翻譯結果包含未知或重複項目。");
    }
    received.set(item.key, item);
  }
  if (received.size !== expected.size) {
    throw new CatalogTranslationOutputError("翻譯結果缺少項目。");
  }

  return request.items.map((sourceItem) => {
    const translated = received.get(sourceItem.key);
    if (!translated) throw new CatalogTranslationOutputError("翻譯結果缺少項目。");
    if (sourceItem.needsName && !translated.name) {
      throw new CatalogTranslationOutputError("翻譯結果缺少名稱。");
    }
    if (sourceItem.needsDescription && !translated.description) {
      throw new CatalogTranslationOutputError("翻譯結果缺少說明。");
    }
    return {
      locale: request.locale,
      entityType: sourceItem.entityType,
      entityId: sourceItem.entityId,
      sourceName: sourceItem.sourceName,
      sourceDescription: sourceItem.sourceDescription,
      name: sourceItem.needsName ? translated.name : null,
      description: sourceItem.needsDescription ? translated.description : null,
    };
  });
}

export function chunkCatalogTranslationRequest(
  request: CatalogTranslationRequest,
  batchSize: number,
): CatalogTranslationRequest[] {
  const chunks: CatalogTranslationRequest[] = [];
  for (let index = 0; index < request.items.length; index += batchSize) {
    const items = request.items.slice(index, index + batchSize).map((item, itemIndex) => ({
      ...item,
      key: `item-${itemIndex}`,
    }));
    chunks.push({ locale: request.locale, items });
  }
  return chunks;
}
