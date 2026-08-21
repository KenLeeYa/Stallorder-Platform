export function isCatalogTranslationEnabled() {
  const configured = process.env.CATALOG_TRANSLATION_ENABLED?.trim();
  if (configured) return configured === "true";
  return process.env.OPENAI_TRANSLATION_ENABLED === "true";
}
