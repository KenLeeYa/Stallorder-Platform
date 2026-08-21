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
      "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=zh-Hant&to=en&textType=html",
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
      { Text: "<div>香酥雞排</div>" },
      { Text: "<div>現點現炸，外酥內嫩。</div>" },
      { Text: "<div>不要胡椒</div>" },
    ]);
  });

  it("以官方 notranslate HTML 保留商家字詞、代碼與數字，並移除回應標記", async () => {
    const protectedRequest: CatalogTranslationRequest = {
      locale: "en",
      items: [{
        ...request.items[0],
        sourceName: "A5 和牛 <限量>",
        sourceDescription: "使用 StallOrder 醬，固定 60g。",
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        translations: [{
          text: '<div><span class="notranslate">A5</span> Wagyu &lt;Limited&gt;</div>',
          to: "en",
        }],
      },
      {
        translations: [{
          text: '<div>Uses <span class="notranslate">StallOrder</span>sauce, fixed at <span class="notranslate">60g</span>.</div>',
          to: "en",
        }],
      },
    ]), { status: 200 }));

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(protectedRequest),
    ).resolves.toEqual({
      items: [{
        key: "item-0",
        name: "A5 Wagyu <Limited>",
        description: "Uses StallOrder sauce, fixed at 60g.",
      }],
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual([
      { Text: '<div><span class="notranslate">A5</span> 和牛 &lt;限量&gt;</div>' },
      {
        Text: '<div>使用 <span class="notranslate">StallOrder</span> 醬，固定 <span class="notranslate">60g</span>。</div>',
      },
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

  it("日文將來源漢字數詞對應的新增數字改回漢字，仍保留來源阿拉伯數字", async () => {
    const japaneseRequest: CatalogTranslationRequest = {
      locale: "ja",
      items: [{
        ...request.items[0],
        sourceName: "第二件 5 折測試雞翅",
        sourceDescription: "同品項每 2 件套用一次優惠。",
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        translations: [{
          text: '<div>2つ目は<span class="notranslate">5</span>割引のテスト手羽先</div>',
          to: "ja",
        }],
      },
      {
        translations: [{
          text: '<div>同じ商品 <span class="notranslate">2</span> 点ごとに1回適用されます。</div>',
          to: "ja",
        }],
      },
    ]), { status: 200 }));

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(japaneseRequest),
    ).resolves.toEqual({
      items: [{
        key: "item-0",
        name: "二つ目は5割引のテスト手羽先",
        description: "同じ商品 2 点ごとに一回適用されます。",
      }],
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

  it.each([
    ["en", "Taiwanese Pork Belly Bun (Gua Bao)"],
    ["ja", "刈包（台湾風豚角煮バーガー）"],
    ["ko", "과바오(대만식 삼겹살 찐빵)"],
    ["vi", "Gua Bao (bánh bao kẹp thịt ba chỉ Đài Loan)"],
    ["th", "กัวเปา (ซาลาเปาไส้หมูสามชั้นแบบไต้หวัน)"],
  ] as const)("文化菜名 glossary 為 %s 提供固定名稱", async (locale, expectedName) => {
    const fetchMock = vi.fn();
    const glossaryRequest: CatalogTranslationRequest = {
      locale,
      items: [{
        ...request.items[1],
        sourceName: "割包",
      }],
    };

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(glossaryRequest),
    ).resolves.toEqual({
      items: [{ key: "item-1", name: expectedName, description: null }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["en", "Winter Melon Tea"],
    ["ja", "冬瓜茶"],
    ["ko", "동과차"],
    ["vi", "Trà bí đao"],
    ["th", "ชาฟักเขียว"],
  ] as const)("冬瓜茶 glossary 為 %s 提供固定名稱", async (locale, expectedName) => {
    const fetchMock = vi.fn();
    const glossaryRequest: CatalogTranslationRequest = {
      locale,
      items: [{
        ...request.items[1],
        sourceName: "冬瓜茶",
      }],
    };

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(glossaryRequest),
    ).resolves.toEqual({
      items: [{ key: "item-1", name: expectedName, description: null }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "en",
      "Winter Melon Tea",
      '<div>Freshly brewed daily: <span class="notranslate">Winter Melon Tea</span>.</div>',
      "Freshly brewed daily: Winter Melon Tea.",
    ],
    [
      "ja",
      "冬瓜茶",
      '<div>毎日煮出した<span class="notranslate">冬瓜茶</span>です。</div>',
      "毎日煮出した冬瓜茶です。",
    ],
    [
      "ko",
      "동과차",
      '<div>매일 끓인 <span class="notranslate">동과차</span>입니다.</div>',
      "매일 끓인 동과차입니다.",
    ],
    [
      "vi",
      "Trà bí đao",
      '<div><span class="notranslate">Trà bí đao</span> được nấu mới mỗi ngày.</div>',
      "Trà bí đao được nấu mới mỗi ngày.",
    ],
    [
      "th",
      "ชาฟักเขียว",
      '<div><span class="notranslate">ชาฟักเขียว</span>ต้มสดใหม่ทุกวัน</div>',
      "ชาฟักเขียวต้มสดใหม่ทุกวัน",
    ],
  ] as const)(
    "以 %s 詞彙表鎖定句中的冬瓜茶",
    async (locale, glossaryTerm, translatedHtml, expectedDescription) => {
      const glossaryRequest: CatalogTranslationRequest = {
        locale,
        items: [{
          ...request.items[0],
          sourceName: "冬瓜茶",
          sourceDescription: "每日現煮冬瓜茶。",
          needsName: false,
          needsDescription: true,
        }],
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
        translations: [{ text: translatedHtml, to: locale }],
      }]), { status: 200 }));

      await expect(
        new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(glossaryRequest),
      ).resolves.toEqual({
        items: [{ key: "item-0", name: null, description: expectedDescription }],
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(String((init as RequestInit).body))).toEqual([{
        Text: `<div>每日現煮<span class="notranslate">${glossaryTerm}</span>。</div>`,
      }]);
    },
  );

  it("上游未保留指定詞彙時 fail closed", async () => {
    const glossaryRequest: CatalogTranslationRequest = {
      locale: "en",
      items: [{
        ...request.items[0],
        sourceName: "冬瓜茶",
        sourceDescription: "每日現煮冬瓜茶。",
        needsName: false,
        needsDescription: true,
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      translations: [{ text: "<div>Chilled traditional winter melon drink.</div>", to: "en" }],
    }]), { status: 200 }));

    await expect(
      new AzureCatalogTranslationProvider(fetchMock as typeof fetch).translate(glossaryRequest),
    ).rejects.toMatchObject({
      code: "AI_TRANSLATION_PROVIDER_FAILED",
      message: "翻譯供應器未保留指定詞彙。",
    });
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
