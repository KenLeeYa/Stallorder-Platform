import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogTranslationRequest } from "./catalog-translation-contract";
import {
  AzureCatalogTranslationProvider,
  getAzureCatalogTranslationProviderLabel,
  isAzureCatalogTranslationConfigured,
} from "./azure-catalog-translation-provider";

const managedEnvironmentKeys = [
  "AI_TRANSLATION_PROVIDER",
  "AZURE_TRANSLATOR_KEY",
  "AZURE_TRANSLATOR_REGION",
  "CATALOG_TRANSLATION_ENABLED",
  "OPENAI_TRANSLATION_ENABLED",
] as const;
const originalEnvironment = Object.fromEntries(
  managedEnvironmentKeys.map((key) => [key, process.env[key]]),
);

const request: CatalogTranslationRequest = {
  locale: "en",
  items: [
    {
      key: "item-0",
      entityType: "PRODUCT",
      entityId: "product-1",
      sourceName: "香酥雞排",
      sourceDescription: "現點現炸，外酥內嫩。",
      context: "炸物",
      existingName: null,
      needsName: true,
      needsDescription: true,
    },
    {
      key: "item-1",
      entityType: "NOTE_OPTION",
      entityId: "option-1",
      sourceName: "不要胡椒",
      sourceDescription: null,
      context: "註記群組：調味",
      existingName: null,
      needsName: true,
      needsDescription: false,
    },
  ],
};

beforeEach(() => {
  for (const key of managedEnvironmentKeys) delete process.env[key];
  process.env.CATALOG_TRANSLATION_ENABLED = "true";
  process.env.AI_TRANSLATION_PROVIDER = "azure-translator";
  process.env.AZURE_TRANSLATOR_KEY = "azure-key";
});

afterAll(() => {
  for (const key of managedEnvironmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("AzureCatalogTranslationProvider", () => {
  it("使用固定官方 endpoint，並依欄位順序還原 Translator 回應", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { translations: [{ text: "Crispy Chicken Cutlet", to: "en" }] },
      { translations: [{ text: "Fried to order, crispy outside and tender inside.", to: "en" }] },
      { translations: [{ text: "No pepper", to: "en" }] },
    ]), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(request),
    ).resolves.toEqual({
      items: [
        {
          key: "item-0",
          name: "Crispy Chicken Cutlet",
          description: "Fried to order, crispy outside and tender inside.",
        },
        { key: "item-1", name: "No pepper", description: null },
      ],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=zh-Hant&to=en",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": "azure-key",
      },
    });
    expect((init as RequestInit).headers).not.toHaveProperty("Ocp-Apim-Subscription-Region");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual([
      { Text: "香酥雞排" },
      { Text: "現點現炸，外酥內嫩。" },
      { Text: "不要胡椒" },
    ]);
  });

  it("regional 或 multi-service resource 才加入 Region header", async () => {
    process.env.AZURE_TRANSLATOR_REGION = "eastasia";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { translations: [{ text: "Crispy Chicken Cutlet", to: "en" }] },
      { translations: [{ text: "Fried to order.", to: "en" }] },
      { translations: [{ text: "No pepper", to: "en" }] },
    ]), { status: 200 }));

    await new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(request);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { "Ocp-Apim-Subscription-Region": "eastasia" },
    });
  });

  it("完整字串命中應用程式 glossary 時不呼叫上游", async () => {
    const fetchMock = vi.fn();
    const glossaryRequest: CatalogTranslationRequest = {
      locale: "ja",
      items: [{
        ...request.items[1],
        sourceName: "加購項目",
      }],
    };

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(glossaryRequest),
    ).resolves.toEqual({
      items: [{ key: "item-1", name: "アドオン項目", description: null }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("每次翻譯重新讀取 Key，支援安全輪替", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { translations: [{ text: "A", to: "en" }] },
        { translations: [{ text: "B", to: "en" }] },
        { translations: [{ text: "C", to: "en" }] },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { translations: [{ text: "A", to: "en" }] },
        { translations: [{ text: "B", to: "en" }] },
        { translations: [{ text: "C", to: "en" }] },
      ]), { status: 200 }));
    const provider = new AzureCatalogTranslationProvider(fetchMock as typeof fetch);

    await provider.translate(request);
    process.env.AZURE_TRANSLATOR_KEY = "rotated-key";
    await provider.translate(request);

    expect(fetchMock.mock.calls.map(([, init]) => (
      (init as RequestInit).headers as Record<string, string>
    )["Ocp-Apim-Subscription-Key"])).toEqual(["azure-key", "rotated-key"]);
  });

  it.each([
    [401, "AUTHENTICATION"],
    [403, "PERMISSION_OR_VERIFICATION"],
    [404, "MODEL_OR_ROUTE"],
    [429, "RATE_LIMIT"],
    [503, "UPSTREAM"],
  ] as const)("將 HTTP %i 安全分類為 %s", async (status, upstreamFailure) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream detail", { status }));

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(request),
    ).rejects.toMatchObject({
      code: "AI_TRANSLATION_PROVIDER_FAILED",
      message: "翻譯供應器暫時無法使用。",
      upstreamFailure,
    });
  });

  it("拒絕錯誤語系、缺項或無效結構，不洩漏上游內容", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { translations: [{ text: "Crispy Chicken Cutlet", to: "fr" }] },
    ]), { status: 200 }));

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(request),
    ).rejects.toMatchObject({
      code: "AI_TRANSLATION_PROVIDER_FAILED",
      message: "翻譯供應器回傳無效結果。",
    });
  });

  it("只有功能啟用且 Azure 設定完整時才回報可用", () => {
    expect(isAzureCatalogTranslationConfigured()).toBe(true);
    expect(getAzureCatalogTranslationProviderLabel()).toBe("Azure Translator");

    process.env.AZURE_TRANSLATOR_REGION = "east asia";
    expect(isAzureCatalogTranslationConfigured()).toBe(false);

    delete process.env.AZURE_TRANSLATOR_REGION;
    process.env.CATALOG_TRANSLATION_ENABLED = "false";
    process.env.OPENAI_TRANSLATION_ENABLED = "true";
    expect(isAzureCatalogTranslationConfigured()).toBe(false);
  });
});
