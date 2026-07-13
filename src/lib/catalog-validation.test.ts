import { describe, expect, it } from "vitest";
import {
  categoryInputSchema,
  categoryUpdateSchema,
  productInputSchema,
  productUpdateSchema,
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
});
