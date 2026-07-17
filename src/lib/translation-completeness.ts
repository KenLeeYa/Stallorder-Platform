import type { QrLocale } from "@/lib/qr-order-i18n";

export type TranslationEntityType = "PRODUCT" | "PRODUCT_DESCRIPTION" | "NOTE_GROUP" | "NOTE_OPTION";

export type TranslationMissingItem = {
  entityType: TranslationEntityType;
  entityId: string;
  sourceName: string;
};

export type TranslationCoverage = {
  locale: QrLocale;
  completed: number;
  total: number;
  percentage: number;
  missing: TranslationMissingItem[];
};

type Translation = { locale: string; name: string; description?: string };
type ProductInput = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  translations: Translation[];
};
type NoteOptionInput = {
  id: string;
  name: string;
  isActive: boolean;
  translations: Translation[];
};
type NoteGroupInput = {
  id: string;
  name: string;
  isActive: boolean;
  translations: Translation[];
  options: NoteOptionInput[];
};

export function calculateTranslationCoverage(
  locales: readonly QrLocale[],
  products: readonly ProductInput[],
  noteGroups: readonly NoteGroupInput[],
) {
  return locales.map((locale): TranslationCoverage => {
    const missing: TranslationMissingItem[] = [];
    let completed = 0;
    let total = 0;
    const sourceLocale = locale === "zh-TW";

    for (const product of products.filter((item) => item.isActive)) {
      const translation = product.translations.find((item) => item.locale === locale);
      total += 1;
      if (sourceLocale || translation?.name.trim()) completed += 1;
      else missing.push({ entityType: "PRODUCT", entityId: product.id, sourceName: product.name });

      if (product.description.trim()) {
        total += 1;
        if (sourceLocale || translation?.description?.trim()) completed += 1;
        else missing.push({ entityType: "PRODUCT_DESCRIPTION", entityId: product.id, sourceName: product.name });
      }
    }

    for (const group of noteGroups.filter((item) => item.isActive)) {
      const translation = group.translations.find((item) => item.locale === locale);
      total += 1;
      if (sourceLocale || translation?.name.trim()) completed += 1;
      else missing.push({ entityType: "NOTE_GROUP", entityId: group.id, sourceName: group.name });

      for (const option of group.options.filter((item) => item.isActive)) {
        const optionTranslation = option.translations.find((item) => item.locale === locale);
        total += 1;
        if (sourceLocale || optionTranslation?.name.trim()) completed += 1;
        else missing.push({ entityType: "NOTE_OPTION", entityId: option.id, sourceName: `${group.name} / ${option.name}` });
      }
    }

    return {
      locale,
      completed,
      total,
      percentage: total === 0 ? 100 : Math.round((completed / total) * 100),
      missing,
    };
  });
}
