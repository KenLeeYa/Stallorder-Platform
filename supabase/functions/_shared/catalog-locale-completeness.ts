type NamedTranslation = {
  locale: string;
  name: string;
};

type ProductTranslation = NamedTranslation & {
  description?: string | null;
};

type CatalogLocaleProduct = {
  description?: string | null;
  translations?: readonly ProductTranslation[];
  categoryTranslations?: readonly NamedTranslation[];
  group?: string | null;
  groupTranslations?: readonly NamedTranslation[];
  noteGroups?: readonly {
    translations?: readonly NamedTranslation[];
    options?: readonly {
      translations?: readonly NamedTranslation[];
    }[];
  }[];
};

export function completeCatalogLocales(
  products: readonly CatalogLocaleProduct[],
  enabledLocales: readonly string[],
) {
  const completeLocales = new Set<string>(["zh-TW"]);

  for (const locale of enabledLocales) {
    if (locale === "zh-TW") continue;
    const isComplete = products.every((product) => {
      const productTranslation = product.translations?.find((translation) => translation.locale === locale);
      if (!productTranslation?.name.trim()) return false;
      if (product.description?.trim() && !productTranslation.description?.trim()) return false;
      if (!product.categoryTranslations?.some((translation) => (
        translation.locale === locale && translation.name.trim()
      ))) return false;
      if (product.group && !product.groupTranslations?.some((translation) => (
        translation.locale === locale && translation.name.trim()
      ))) return false;

      return (product.noteGroups ?? []).every((group) => (
        group.translations?.some((translation) => (
          translation.locale === locale && translation.name.trim()
        ))
        && (group.options ?? []).every((option) => option.translations?.some((translation) => (
          translation.locale === locale && translation.name.trim()
        )))
      ));
    });
    if (isComplete) completeLocales.add(locale);
  }

  return [...completeLocales];
}
