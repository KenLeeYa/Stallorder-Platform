import { describe, expect, it } from "vitest";
import {
  getProductNoteFieldErrors,
  getReusableProductNoteDuplicateFieldErrors,
  productNoteCommandSchema,
} from "./product-note-validation";

const reusableNoteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const secondReusableNoteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const noteGroupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

describe("共用商品註記輸入驗證", () => {
  const reusableNote = {
    operation: "CREATE_REUSABLE_NOTE",
    name: "不要香菜",
    priceDelta: 0,
    sortOrder: 1,
    isActive: true,
    translations: [{ locale: "en", name: "No cilantro" }],
  } as const;

  it("接受共用單一註記的建立與更新", () => {
    expect(productNoteCommandSchema.safeParse(reusableNote).success).toBe(true);
    expect(productNoteCommandSchema.safeParse({
      ...reusableNote,
      operation: "UPDATE_REUSABLE_NOTE",
      reusableNoteId,
    }).success).toBe(true);
  });

  it("接受將共用註記加入群組並保留群組內排序", () => {
    expect(productNoteCommandSchema.safeParse({
      operation: "ATTACH_REUSABLE_NOTE",
      reusableNoteId,
      noteGroupId,
      sortOrder: 3,
    }).success).toBe(true);
  });

  it("接受一次加入多個不重複的共用註記", () => {
    expect(productNoteCommandSchema.safeParse({
      operation: "ATTACH_REUSABLE_NOTES",
      noteGroupId,
      reusableNoteIds: [reusableNoteId, secondReusableNoteId],
    }).success).toBe(true);
  });

  it("拒絕空白、重複、超量或帶越權欄位的批次共用註記", () => {
    const command = {
      operation: "ATTACH_REUSABLE_NOTES",
      noteGroupId,
    } as const;
    expect(productNoteCommandSchema.safeParse({ ...command, reusableNoteIds: [] }).success).toBe(false);

    const duplicate = productNoteCommandSchema.safeParse({
      ...command,
      reusableNoteIds: [reusableNoteId, reusableNoteId],
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(getProductNoteFieldErrors(duplicate.error).reusableNoteIds)
        .toBe("共用單一註記不可重複選擇。");
    }

    expect(productNoteCommandSchema.safeParse({
      ...command,
      reusableNoteIds: Array.from({ length: 101 }, () => crypto.randomUUID()),
    }).success).toBe(false);
    expect(productNoteCommandSchema.safeParse({
      ...command,
      reusableNoteIds: [reusableNoteId],
      organizationId: crypto.randomUUID(),
    }).success).toBe(false);
  });

  it("拒絕越權組織欄位、重複翻譯與超界排序", () => {
    expect(productNoteCommandSchema.safeParse({
      ...reusableNote,
      organizationId: crypto.randomUUID(),
    }).success).toBe(false);
    expect(productNoteCommandSchema.safeParse({
      ...reusableNote,
      translations: [
        { locale: "en", name: "No cilantro" },
        { locale: "en", name: "Without cilantro" },
      ],
    }).success).toBe(false);
    expect(productNoteCommandSchema.safeParse({
      operation: "ATTACH_REUSABLE_NOTE",
      reusableNoteId,
      noteGroupId,
      sortOrder: 10_001,
    }).success).toBe(false);
  });

  it("將群組上下限與共用註記重名對應至可見欄位", () => {
    const result = productNoteCommandSchema.safeParse({
      operation: "CREATE_NOTE_GROUP",
      name: "加料",
      selectionMode: "MULTIPLE",
      isRequired: true,
      minSelections: 2,
      maxSelections: 1,
      sortOrder: 1,
      isActive: true,
      productIds: [],
      translations: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(getProductNoteFieldErrors(result.error).maxSelections).toBe("最多選取數不可小於最少選取數。");
    }
    expect(getReusableProductNoteDuplicateFieldErrors("CREATE_REUSABLE_NOTE"))
      .toEqual({ name: "已有相同名稱的共用單一註記，請使用其他名稱。" });
    expect(getReusableProductNoteDuplicateFieldErrors("ATTACH_REUSABLE_NOTES"))
      .toEqual({ reusableNoteIds: "部分共用單一註記已在群組中，請重新整理後再選擇。" });
  });

  it("將商品指派數量與重複限制對應至 productIds 欄位", () => {
    const group = {
      operation: "CREATE_NOTE_GROUP",
      name: "加料",
      selectionMode: "MULTIPLE",
      isRequired: false,
      minSelections: 0,
      maxSelections: null,
      sortOrder: 1,
      isActive: true,
      translations: [],
    } as const;
    const productId = crypto.randomUUID();
    const duplicateProducts = productNoteCommandSchema.safeParse({
      ...group,
      productIds: [productId, productId],
    });
    expect(duplicateProducts.success).toBe(false);
    if (!duplicateProducts.success) {
      expect(getProductNoteFieldErrors(duplicateProducts.error).productIds).toBe("商品不可重複指派。");
    }

    const tooManyProducts = productNoteCommandSchema.safeParse({
      ...group,
      productIds: Array.from({ length: 101 }, () => crypto.randomUUID()),
    });
    expect(tooManyProducts.success).toBe(false);
    if (!tooManyProducts.success) {
      expect(getProductNoteFieldErrors(tooManyProducts.error).productIds)
        .toBe("「指派商品」輸入不正確，請依欄位限制重新輸入。");
    }
  });

  it("接受註記排序命令並拒絕重複項目", () => {
    expect(productNoteCommandSchema.safeParse({
      operation: "REORDER_NOTE_GROUPS",
      noteGroupIds: [noteGroupId, crypto.randomUUID()],
    }).success).toBe(true);
    expect(productNoteCommandSchema.safeParse({
      operation: "REORDER_NOTE_OPTIONS",
      noteGroupId,
      noteOptionIds: [reusableNoteId, reusableNoteId],
    }).success).toBe(false);
  });
});
