import { describe, expect, it } from "vitest";
import {
  parseProductNoteTransfer,
  productNoteTransferFileName,
  serializeProductNoteTransfer,
} from "@/lib/product-note-transfer";

const validTransfer = {
  schemaVersion: 1,
  exportedAt: "2026-08-05T00:00:00.000Z",
  sourceCurrency: "TWD",
  reusableNotes: [{
    name: "不加香菜",
    priceDelta: 0,
    sortOrder: 1,
    isActive: true,
    translations: [{ locale: "en", name: "No cilantro" }],
  }],
  groups: [{
    name: "河粉不加品項",
    selectionMode: "MULTIPLE",
    isRequired: false,
    minSelections: 0,
    maxSelections: 3,
    sortOrder: 1,
    isActive: true,
    translations: [],
    products: [{ id: "11111111-1111-4111-8111-111111111111", name: "招牌河粉", sortOrder: 37 }],
    options: [{
      name: "不加香菜",
      reusableNoteName: "不加香菜",
      priceDelta: 0,
      sortOrder: 1,
      isActive: true,
      translations: [],
    }],
  }],
};

describe("product note transfer", () => {
  it("accepts a complete reusable-note and group export", () => {
    const result = parseProductNoteTransfer(JSON.stringify(validTransfer));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transfer.groups[0].products[0].name).toBe("招牌河粉");
  });

  it("rejects links to reusable notes missing from the file", () => {
    const value = structuredClone(validTransfer);
    value.groups[0].options[0].reusableNoteName = "不存在";
    const result = parseProductNoteTransfer(JSON.stringify(value));
    expect(result).toEqual({
      ok: false,
      error: "註記群組第 1 筆 > 群組註記第 1 筆 > 共用註記名稱：共用單一註記「不存在」不在匯入檔中。",
    });
  });

  it("rejects duplicate group names after normalization", () => {
    const value = structuredClone(validTransfer);
    value.groups.push({ ...structuredClone(value.groups[0]), name: " 河粉不加品項 " });
    const result = parseProductNoteTransfer(JSON.stringify(value));
    expect(result).toEqual({ ok: false, error: "註記群組第 2 筆 > 名稱：註記群組名稱不可重複。" });
  });

  it("round-trips an active required group that is temporarily missing active options", () => {
    const value = structuredClone(validTransfer);
    value.groups[0].isRequired = true;
    value.groups[0].minSelections = 1;
    value.groups[0].options = [];
    const serialized = serializeProductNoteTransfer(value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = parseProductNoteTransfer(serialized.text);
    expect(parsed).toEqual({ ok: true, transfer: serialized.transfer });
  });

  it("allows an inactive group to preserve a temporarily unready legal state", () => {
    const value = structuredClone(validTransfer);
    value.groups[0].isActive = false;
    value.groups[0].isRequired = true;
    value.groups[0].minSelections = 1;
    value.reusableNotes[0].isActive = false;
    const serialized = serializeProductNoteTransfer(value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(parseProductNoteTransfer(serialized.text).ok).toBe(true);
  });

  it("rejects a currency that is not an uppercase ISO-style code", () => {
    const value = structuredClone(validTransfer);
    value.sourceCurrency = "twd";
    expect(parseProductNoteTransfer(JSON.stringify(value))).toEqual({
      ok: false,
      error: "來源幣別：來源幣別必須是三碼大寫代碼。",
    });
  });

  it("round-trips the aggregate option and assignment limits within the 1MB contract", () => {
    const value = {
      schemaVersion: 1,
      exportedAt: "2026-08-05T00:00:00.000Z",
      sourceCurrency: "TWD",
      reusableNotes: [],
      groups: Array.from({ length: 10 }, (_, groupIndex) => ({
      name: `群組${groupIndex}`,
      selectionMode: "MULTIPLE",
      isRequired: false,
      minSelections: 0,
      maxSelections: null,
      sortOrder: groupIndex,
      isActive: true,
      translations: [],
      products: Array.from({ length: 100 }, (_, itemIndex) => ({
        id: `00000000-0000-4000-8000-${String(groupIndex * 100 + itemIndex).padStart(12, "0")}`,
        name: `商品${groupIndex}-${itemIndex}`,
        sortOrder: itemIndex,
      })),
      options: Array.from({ length: 100 }, (_, itemIndex) => ({
        name: `註記${groupIndex}-${itemIndex}`,
        reusableNoteName: null,
        priceDelta: 0,
        sortOrder: itemIndex,
        isActive: true,
        translations: [],
      })),
      })),
    };
    const serialized = serializeProductNoteTransfer(value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(new TextEncoder().encode(serialized.text).byteLength).toBeLessThanOrEqual(1_000_000);
    const parsed = parseProductNoteTransfer(serialized.text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.transfer.groups.flatMap((group) => group.options)).toHaveLength(1_000);
      expect(parsed.transfer.groups.flatMap((group) => group.products)).toHaveLength(1_000);
      expect(parsed.transfer.groups[0].products[0].sortOrder).toBe(0);
    }
  });

  it("refuses to serialize a structurally valid aggregate that would exceed the shared 1MB limit", () => {
    const value = {
      schemaVersion: 1,
      exportedAt: "2026-08-05T00:00:00.000Z",
      sourceCurrency: "TWD",
      reusableNotes: [],
      groups: Array.from({ length: 5 }, (_, groupIndex) => ({
        name: `大型群組${groupIndex}`,
        selectionMode: "MULTIPLE",
        isRequired: false,
        minSelections: 0,
        maxSelections: null,
        sortOrder: groupIndex,
        isActive: true,
        translations: [],
        products: [],
        options: Array.from({ length: 200 }, (_, optionIndex) => ({
          name: `註記${groupIndex}-${optionIndex}`,
          reusableNoteName: null,
          priceDelta: 0,
          sortOrder: optionIndex,
          isActive: true,
          translations: ["en", "ja", "ko", "vi", "th"].map((locale) => ({
            locale,
            name: "長".repeat(120),
          })),
        })),
      })),
    };
    expect(serializeProductNoteTransfer(value)).toEqual({
      ok: false,
      error: "註記資料超過 1MB 匯出上限，請精簡註記後再匯出。",
    });
  });

  it("rejects invalid JSON and oversized files", () => {
    expect(parseProductNoteTransfer("{")).toEqual({ ok: false, error: "註記匯入檔不是有效的 JSON。" });
    expect(parseProductNoteTransfer(`"${"x".repeat(1_000_001)}"`))
      .toEqual({ ok: false, error: "註記匯入檔不可超過 1MB。" });
  });

  it("uses a stable dated export filename", () => {
    expect(productNoteTransferFileName(new Date("2026-08-05T23:59:59.000Z")))
      .toBe("stallorder-product-notes-2026-08-05.json");
  });
});
