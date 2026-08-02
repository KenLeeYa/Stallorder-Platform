import { describe, expect, it } from "vitest";
import {
  categoryInputSchema,
  categoryUpdateSchema,
  getSharedCatalogFieldErrors,
  productInputSchema,
  productUpdateSchema,
  sharedCatalogCommandSchema,
} from "./catalog-validation";

describe("商品與分類輸入驗證", () => {
  const product = {
    categoryId: "77777777-7777-4777-8777-777777777771",
    name: "香酥雞排",
    description: "現炸",
    price: 95,
    sortOrder: 1,
    isAvailable: true,
  };

  it("接受完整商品並拒絕越權欄位", () => {
    expect(productInputSchema.safeParse(product).success).toBe(true);
    expect(productInputSchema.safeParse({ ...product, organizationId: crypto.randomUUID() }).success).toBe(false);
  });

  it("拒絕負數價格、非整數價格與空更新", () => {
    expect(productInputSchema.safeParse({ ...product, price: -1 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...product, price: 1.5 }).success).toBe(false);
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("驗證分類名稱、排序與嚴格欄位", () => {
    expect(categoryInputSchema.safeParse({ name: "炸物", sortOrder: 1, isActive: true }).success).toBe(true);
    expect(categoryInputSchema.safeParse({ name: "", sortOrder: 1, isActive: true }).success).toBe(false);
    expect(categoryUpdateSchema.safeParse({ stallId: crypto.randomUUID() }).success).toBe(false);
  });

  it("接受一般商品與套餐種類，並維持舊建立請求的 SINGLE 預設值", () => {
    const command = {
      operation: "CREATE_PRODUCT",
      categoryId: "77777777-7777-4777-8777-777777777771",
      groupId: null,
      name: "午餐套餐",
      description: "主餐搭配飲料",
      defaultPrice: 180,
      imageUrl: null,
      sortOrder: 1,
      stallIds: [],
      translations: [],
    };
    const legacy = sharedCatalogCommandSchema.safeParse(command);
    const bundle = sharedCatalogCommandSchema.safeParse({ ...command, kind: "BUNDLE" });

    expect(legacy.success && legacy.data.operation === "CREATE_PRODUCT" ? legacy.data.kind : null).toBe("SINGLE");
    expect(bundle.success && bundle.data.operation === "CREATE_PRODUCT" ? bundle.data.kind : null).toBe("BUNDLE");
    expect(sharedCatalogCommandSchema.safeParse({ ...command, kind: "GROUP" }).success).toBe(false);
  });

  it("將空白售價與攤位分派限制對應至可見欄位", () => {
    const command = {
      operation: "CREATE_PRODUCT",
      categoryId: "77777777-7777-4777-8777-777777777771",
      groupId: null,
      name: "測試商品",
      description: "",
      defaultPrice: "",
      imageUrl: null,
      sortOrder: 1,
      stallIds: [],
      translations: [],
    };
    const blankPrice = sharedCatalogCommandSchema.safeParse(command);
    expect(blankPrice.success).toBe(false);
    if (!blankPrice.success) {
      expect(getSharedCatalogFieldErrors(blankPrice.error).defaultPrice)
        .toBe("「預設價格」輸入不正確，請依欄位限制重新輸入。");
    }

    const stallId = crypto.randomUUID();
    const duplicateStalls = sharedCatalogCommandSchema.safeParse({
      ...command,
      defaultPrice: 0,
      stallIds: [stallId, stallId],
    });
    expect(duplicateStalls.success).toBe(false);
    if (!duplicateStalls.success) {
      expect(getSharedCatalogFieldErrors(duplicateStalls.error).stallIds).toBe("攤位清單不可重複。");
    }

    const tooManyStalls = sharedCatalogCommandSchema.safeParse({
      ...command,
      defaultPrice: 0,
      stallIds: Array.from({ length: 101 }, () => crypto.randomUUID()),
    });
    expect(tooManyStalls.success).toBe(false);
    if (!tooManyStalls.success) {
      expect(getSharedCatalogFieldErrors(tooManyStalls.error).stallIds)
        .toBe("「分派攤位」輸入不正確，請依欄位限制重新輸入。");
    }
  });

  it("驗證套餐選擇群組上下限", () => {
    const command = {
      operation: "CREATE_BUNDLE_CHOICE_GROUP",
      bundleProductId: "44444444-4444-4444-8444-444444444441",
      name: "選一份主餐",
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 1,
    };

    expect(sharedCatalogCommandSchema.safeParse(command).success).toBe(true);
    const invalidRange = sharedCatalogCommandSchema.safeParse({ ...command, minSelections: 2 });
    expect(invalidRange.success).toBe(false);
    if (!invalidRange.success) {
      expect(getSharedCatalogFieldErrors(invalidRange.error).maxSelections)
        .toBe("套餐群組最少選擇數不可大於最多選擇數。");
    }
    expect(sharedCatalogCommandSchema.safeParse({ ...command, maxSelections: 21 }).success).toBe(false);
  });

  it("驗證套餐選項數量、價差與嚴格欄位", () => {
    const command = {
      operation: "CREATE_BUNDLE_CHOICE",
      choiceGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      componentProductId: "44444444-4444-4444-8444-444444444441",
      quantity: 1,
      priceDelta: 20,
      isEnabled: true,
      sortOrder: 1,
    };

    expect(sharedCatalogCommandSchema.safeParse(command).success).toBe(true);
    expect(sharedCatalogCommandSchema.safeParse({ ...command, quantity: 0 }).success).toBe(false);
    expect(sharedCatalogCommandSchema.safeParse({ ...command, organizationId: crypto.randomUUID() }).success).toBe(false);
  });
});
