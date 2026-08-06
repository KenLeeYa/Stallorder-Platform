import { describe, expect, it } from "vitest";
import { buildProductNoteImportPreview } from "@/lib/product-note-import-preview";
import type { ProductNoteTransfer } from "@/lib/product-note-transfer";

const transfer: ProductNoteTransfer = {
  schemaVersion: 1,
  exportedAt: "2026-08-05T00:00:00.000Z",
  sourceCurrency: "TWD",
  reusableNotes: [{
    name: "不加香菜",
    priceDelta: 10,
    sortOrder: 2,
    isActive: true,
    translations: [{ locale: "en", name: "No cilantro" }],
  }],
  groups: [{
    name: "客製口味",
    selectionMode: "MULTIPLE",
    isRequired: false,
    minSelections: 0,
    maxSelections: 2,
    sortOrder: 4,
    isActive: true,
    translations: [],
    products: [{
      id: "11111111-1111-4111-8111-111111111111",
      name: "招牌河粉",
      sortOrder: 37,
    }],
    options: [{
      name: "不加香菜",
      reusableNoteName: "不加香菜",
      priceDelta: 10,
      sortOrder: 8,
      isActive: true,
      translations: [],
    }],
  }],
};

describe("product note import preview", () => {
  it("marks same-name records as updates and exposes overwritten field differences", () => {
    const preview = buildProductNoteImportPreview(transfer, [[{
      productId: "11111111-1111-4111-8111-111111111111",
      productName: "招牌河粉",
      sortOrder: 37,
    }]], {
      reusableNotes: [{
        name: "不加香菜",
        priceDelta: 0,
        sortOrder: 1,
        isActive: false,
        translations: [],
      }],
      groups: [{
        name: "客製口味",
        selectionMode: "SINGLE",
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 1,
        isActive: true,
        translations: [],
        assignments: [{
          productId: "11111111-1111-4111-8111-111111111111",
          productName: "招牌河粉",
          sortOrder: 5,
          isActive: false,
        }],
        options: [{
          name: "不加香菜",
          reusableNoteName: "不加香菜",
          priceDelta: 0,
          sortOrder: 1,
          isActive: false,
          translations: [],
        }],
      }],
    });

    expect(preview.counts).toEqual({
      reusableNoteCreateCount: 0,
      reusableNoteUpdateCount: 1,
      groupCreateCount: 0,
      groupUpdateCount: 1,
    });
    expect(preview.reusableNotes[0]).toMatchObject({
      changeType: "UPDATE",
      changes: expect.arrayContaining([
        { field: "價格調整", before: "0 TWD", after: "10 TWD" },
        { field: "翻譯（en）", before: "尚未設定", after: "No cilantro" },
      ]),
    });
    expect(preview.groups[0]).toMatchObject({
      changeType: "UPDATE",
      changes: expect.arrayContaining([
        { field: "選取方式", before: "單選", after: "複選" },
        { field: "商品指派「招牌河粉」排序", before: "5", after: "37" },
        { field: "商品指派「招牌河粉」啟用狀態", before: "停用", after: "啟用" },
        { field: "群組註記「不加香菜」排序", before: "1", after: "8" },
      ]),
    });
  });

  it("marks missing records as creates", () => {
    const preview = buildProductNoteImportPreview(transfer, [[]], {
      reusableNotes: [],
      groups: [],
    });
    expect(preview.reusableNotes[0].changeType).toBe("CREATE");
    expect(preview.groups[0].changeType).toBe("CREATE");
  });

  it("returns every field difference without truncating long updates", () => {
    const preview = buildProductNoteImportPreview({
      ...transfer,
      reusableNotes: [],
      groups: [{
        ...transfer.groups[0],
        translations: [
          { locale: "en", name: "Custom flavor" },
          { locale: "ja", name: "カスタム味" },
          { locale: "ko", name: "맞춤 맛" },
          { locale: "vi", name: "Hương vị tùy chỉnh" },
          { locale: "th", name: "รสชาติที่กำหนดเอง" },
        ],
      }],
    }, [[{
      productId: "11111111-1111-4111-8111-111111111111",
      productName: "招牌河粉",
      sortOrder: 37,
    }]], {
      reusableNotes: [],
      groups: [{
        name: "客製口味",
        selectionMode: "SINGLE",
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 1,
        isActive: true,
        translations: [],
        assignments: [{
          productId: "11111111-1111-4111-8111-111111111111",
          productName: "招牌河粉",
          sortOrder: 5,
          isActive: false,
        }],
        options: [{
          name: "不加香菜",
          reusableNoteName: "不加香菜",
          priceDelta: 0,
          sortOrder: 1,
          isActive: false,
          translations: [],
        }],
      }],
    });

    expect(preview.groups[0].changes.length).toBeGreaterThan(12);
    expect(preview.groups[0].changes).toEqual(expect.arrayContaining([
      { field: "翻譯（th）", before: "尚未設定", after: "รสชาติที่กำหนดเอง" },
      { field: "群組註記「不加香菜」排序", before: "1", after: "8" },
    ]));
    expect(preview.groups[0].additionalChangeCount).toBe(0);
  });
});
