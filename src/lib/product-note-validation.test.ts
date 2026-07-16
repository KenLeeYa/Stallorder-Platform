import { describe, expect, it } from "vitest";
import { productNoteCommandSchema } from "./product-note-validation";

const base = {
  operation: "CREATE_NOTE_GROUP" as const,
  name: "加料",
  selectionMode: "MULTIPLE" as const,
  isRequired: true,
  minSelections: 1,
  maxSelections: 2,
  sortOrder: 1,
  isActive: true,
  productIds: [],
  translations: [],
};

describe("商品註記群組數量限制", () => {
  it("接受必選且最少與最多數量一致的設定", () => {
    expect(productNoteCommandSchema.safeParse(base).success).toBe(true);
  });

  it("拒絕必選群組的最少數量為零", () => {
    expect(productNoteCommandSchema.safeParse({ ...base, minSelections: 0 }).success).toBe(false);
  });

  it("拒絕最多數量小於最少數量", () => {
    expect(productNoteCommandSchema.safeParse({ ...base, minSelections: 3, maxSelections: 2 }).success).toBe(false);
  });
});
