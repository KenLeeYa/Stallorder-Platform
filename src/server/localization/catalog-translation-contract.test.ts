import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  buildCatalogTranslationRequests,
  catalogTranslationOutputSchema,
  CatalogTranslationOutputError,
  chunkCatalogTranslationRequest,
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

  it("批次切割後保留實體對應並重建短鍵值", () => {
    const [request] = buildCatalogTranslationRequests(source, ["en"]);
    const chunks = chunkCatalogTranslationRequest(request, 1);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.items[0].key)).toEqual(["item-0", "item-0"]);
    expect(chunks.map((chunk) => chunk.items[0].entityId)).toEqual(["product-1", "option-1"]);
  });
});
