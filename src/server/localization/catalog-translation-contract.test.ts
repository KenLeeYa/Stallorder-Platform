import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  buildCatalogTranslationRequests,
  catalogTranslationOutputSchema,
  CatalogTranslationOutputError,
  chunkCatalogTranslationRequest,
  getProtectedTranslationTokens,
  validateCatalogTranslationOutput,
  type CatalogTranslationSource,
} from "./catalog-translation-contract";

const source: CatalogTranslationSource = {
  products: [{
    id: "product-1",
    name: "香酥雞排",
    description: "現點現炸，外酥內嫩。",
    categoryName: "炸物",
    groupName: null,
    translations: [{
      locale: "en",
      name: "Crispy Chicken Cutlet",
      description: "",
    }],
  }],
  noteGroups: [{
    id: "group-1",
    name: "加料",
    translations: [{ locale: "en", name: "Extras" }],
    options: [{
      id: "option-1",
      name: "加蛋",
      translations: [],
    }],
  }],
};

describe("catalog translation contract", () => {
  it("可轉換為 OpenAI Structured Outputs 格式", () => {
    expect(() => zodTextFormat(catalogTranslationOutputSchema, "catalog_translations")).not.toThrow();
  });

  it("只規劃指定語系的缺漏欄位並保留人工名稱", () => {
    const requests = buildCatalogTranslationRequests(source, ["en"]);
    expect(requests).toHaveLength(1);
    expect(requests[0].items).toEqual([
      expect.objectContaining({
        entityType: "PRODUCT",
        entityId: "product-1",
        existingName: "Crispy Chicken Cutlet",
        needsName: false,
        needsDescription: true,
      }),
      expect.objectContaining({
        entityType: "NOTE_OPTION",
        entityId: "option-1",
        needsName: true,
        needsDescription: false,
      }),
    ]);
  });

  it("驗證完整輸出並忽略不需覆蓋的欄位", () => {
    const [request] = buildCatalogTranslationRequests(source, ["en"]);
    const result = validateCatalogTranslationOutput(request, {
      items: [
        {
          key: request.items[0].key,
          name: "Do not overwrite",
          description: "Fried to order with a crisp exterior and tender center.",
        },
        {
          key: request.items[1].key,
          name: "Add Egg",
          description: null,
        },
      ],
    });
    expect(result).toEqual([
      {
        locale: "en",
        entityType: "PRODUCT",
        entityId: "product-1",
        sourceName: "香酥雞排",
        sourceDescription: "現點現炸，外酥內嫩。",
        name: null,
        description: "Fried to order with a crisp exterior and tender center.",
      },
      {
        locale: "en",
        entityType: "NOTE_OPTION",
        entityId: "option-1",
        sourceName: "加蛋",
        sourceDescription: null,
        name: "Add Egg",
        description: null,
      },
    ]);
  });

  it("拒絕缺漏、未知或重複的模型輸出", () => {
    const [request] = buildCatalogTranslationRequests(source, ["en"]);
    expect(() => validateCatalogTranslationOutput(request, {
      items: [{
        key: "unknown",
        name: "Unknown",
        description: null,
      }],
    })).toThrow(CatalogTranslationOutputError);
    expect(() => validateCatalogTranslationOutput(request, {
      items: [{
        key: request.items[0].key,
        name: null,
        description: "Translated description",
      }],
    })).toThrow(CatalogTranslationOutputError);
  });

  it("保留混合中文中的拉丁商家字詞、原數字順序與重數", () => {
    expect(getProtectedTranslationTokens("Gateway Preview 翻譯商品 A5 20260813"))
      .toEqual(["Gateway Preview", "A5 20260813"]);
    expect(getProtectedTranslationTokens("Gateway＋Pro 商品 A／B A＿B"))
      .toEqual(["Gateway+Pro", "A/B A_B"]);
    expect(getProtectedTranslationTokens("Fresh Fried Chicken")).toEqual([]);
    const [request] = buildCatalogTranslationRequests({
      products: [{
        id: "guard-product",
        name: "Gateway Preview 翻譯商品 A5 20260813",
        description: "容量 ５００ 毫升，比例 1:2。",
        categoryName: "測試",
        groupName: null,
        translations: [],
      }],
      noteGroups: [],
    }, ["en"]);

    expect(validateCatalogTranslationOutput(request, {
      items: [{
        key: request.items[0].key,
        name: "Gateway Preview Translation Product A5 20260813",
        description: "Capacity 500 ml, ratio 1:2.",
      }],
    })).toHaveLength(1);
    expect(validateCatalogTranslationOutput(request, {
      items: [{
        key: request.items[0].key,
        name: "Gateway Preview—翻譯商品 A5 20260813",
        description: "Capacity 500 ml, ratio 1:2.",
      }],
    })).toHaveLength(1);
    expect(() => validateCatalogTranslationOutput(request, {
      items: [{
        key: request.items[0].key,
        name: "Preview Gateway Translation Product A5 20260813",
        description: "Capacity 500 ml, ratio 1:2.",
      }],
    })).toThrow("翻譯名稱未保留商家指定字詞或代碼。");
    expect(() => validateCatalogTranslationOutput(request, {
      items: [{
        key: request.items[0].key,
        name: "A5 20260813 Gateway Preview Translation Product",
        description: "Capacity 500 ml, ratio 1:2.",
      }],
    })).toThrow("翻譯名稱未保留商家指定字詞或代碼。");
    for (const alteredName of [
      "Fake-Gateway Preview Translation Product A5 20260813",
      "Gateway Preview-Pro Translation Product A5 20260813",
      "Gateway Preview.official Translation Product A5 20260813",
      "Gateway Preview＋official Translation Product A5 20260813",
    ]) {
      expect(() => validateCatalogTranslationOutput(request, {
        items: [{
          key: request.items[0].key,
          name: alteredName,
          description: "Capacity 500 ml, ratio 1:2.",
        }],
      })).toThrow("翻譯名稱未保留商家指定字詞或代碼。");
    }
    expect(() => validateCatalogTranslationOutput(request, {
      items: [{
        key: request.items[0].key,
        name: "Gateway Preview Translation Product A5 20260813",
        description: "Capacity 500 ml, ratio 2:1.",
      }],
    })).toThrow("翻譯說明新增、遺漏或調換了來源數字。");

    const compatibilityJoinerRequest = {
      ...request,
      items: [{
        ...request.items[0],
        sourceName: "Gateway＋Pro 商品 A／B A＿B 5",
      }],
    };
    expect(validateCatalogTranslationOutput(compatibilityJoinerRequest, {
      items: [{
        key: request.items[0].key,
        name: "Gateway+Pro Product A/B A_B 5",
        description: "Capacity 500 ml, ratio 1:2.",
      }],
    })).toHaveLength(1);
    for (const [sourceName, alteredName] of [
      ["Gateway 商品 5", "Gateway＋Pro Product 5"],
      ["Gateway＋Pro 商品 5", "Gateway Pro Product 5"],
      ["A／B 商品 5", "A B Product 5"],
      ["A＿B 商品 5", "A B Product 5"],
    ]) {
      expect(() => validateCatalogTranslationOutput({
        ...request,
        items: [{ ...request.items[0], sourceName }],
      }, {
        items: [{
          key: request.items[0].key,
          name: alteredName,
          description: "Capacity 500 ml, ratio 1:2.",
        }],
      })).toThrow("翻譯名稱未保留商家指定字詞或代碼。");
    }

    const repeatedNumberRequest = {
      ...request,
      items: [{
        ...request.items[0],
        sourceDescription: "每份 2 個，買 2 份。",
      }],
    };
    expect(() => validateCatalogTranslationOutput(repeatedNumberRequest, {
      items: [{
        key: request.items[0].key,
        name: "Gateway Preview Translation Product A5 20260813",
        description: "Two pieces per serving.",
      }],
    })).toThrow("翻譯說明新增、遺漏或調換了來源數字。");
  });

  it("批次切割後保留實體對應並重建短鍵值", () => {
    const [request] = buildCatalogTranslationRequests(source, ["en"]);
    const chunks = chunkCatalogTranslationRequest(request, 1);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.items[0].key)).toEqual(["item-0", "item-0"]);
    expect(chunks.map((chunk) => chunk.items[0].entityId)).toEqual(["product-1", "option-1"]);
  });

  it("共用單一註記只建立一份翻譯目標", () => {
    const [request] = buildCatalogTranslationRequests({
      products: [],
      noteGroups: [
        { id: "group-1", name: "辣度", translations: [], options: [] },
        { id: "group-2", name: "加料", translations: [], options: [] },
      ],
      reusableNotes: [{ id: "reusable-note-1", name: "不要香菜", translations: [] }],
    }, ["en"]);

    expect(request.items.filter((item) => item.entityType === "REUSABLE_NOTE")).toEqual([expect.objectContaining({
      entityType: "REUSABLE_NOTE",
      entityId: "reusable-note-1",
      context: "共用單一註記",
    })]);
    expect(request.items.filter((item) => item.entityType === "NOTE_OPTION")).toHaveLength(0);
  });
});
