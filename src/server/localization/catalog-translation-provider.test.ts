import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AzureCatalogTranslationProvider } from "./azure-catalog-translation-provider";
import {
  createCatalogTranslationProvider,
  getCatalogTranslationProviderLabel,
  isCatalogTranslationConfigured,
  resolveCatalogTranslationRequestCredential,
} from "./catalog-translation-provider";
import { OpenAiCatalogTranslationProvider } from "./openai-catalog-translation-provider";

const managedEnvironmentKeys = [
  "AI_TRANSLATION_PROVIDER",
  "AZURE_TRANSLATOR_KEY",
  "CATALOG_TRANSLATION_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_TRANSLATION_ENABLED",
] as const;
const originalEnvironment = Object.fromEntries(
  managedEnvironmentKeys.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of managedEnvironmentKeys) delete process.env[key];
});

afterAll(() => {
  for (const key of managedEnvironmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("catalog translation provider selection", () => {
  it("Azure 設定只建立 Azure provider，不解析 Vercel credential", async () => {
    process.env.CATALOG_TRANSLATION_ENABLED = "true";
    process.env.AI_TRANSLATION_PROVIDER = "azure-translator";
    process.env.AZURE_TRANSLATOR_KEY = "azure-key";

    await expect(resolveCatalogTranslationRequestCredential()).resolves.toBeUndefined();
    expect(isCatalogTranslationConfigured()).toBe(true);
    expect(getCatalogTranslationProviderLabel()).toBe("Azure Translator");
    expect(createCatalogTranslationProvider()).toBeInstanceOf(AzureCatalogTranslationProvider);
  });

  it("保留既有 OpenAI 預設與 legacy enable flag 相容性", () => {
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "openai-key";

    expect(isCatalogTranslationConfigured()).toBe(true);
    expect(createCatalogTranslationProvider()).toBeInstanceOf(OpenAiCatalogTranslationProvider);
  });

  it("明確的通用停用開關優先於 legacy enable flag", () => {
    process.env.CATALOG_TRANSLATION_ENABLED = "false";
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "openai-key";

    expect(isCatalogTranslationConfigured()).toBe(false);
    expect(getCatalogTranslationProviderLabel()).toBeNull();
  });
});
