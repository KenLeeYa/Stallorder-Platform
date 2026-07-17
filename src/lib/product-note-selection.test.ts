import { describe, expect, it } from "vitest";
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "./product-note-selection";

const single = {
  selectionMode: "SINGLE" as const,
  minSelections: 1,
  maxSelections: 1,
  options: [{ id: "mild", priceDelta: 0 }, { id: "hot", priceDelta: 10 }],
};
const multiple = {
  selectionMode: "MULTIPLE" as const,
  minSelections: 0,
  maxSelections: 2,
  options: [{ id: "egg", priceDelta: 15 }, { id: "cheese", priceDelta: 20 }, { id: "basil", priceDelta: 5 }],
};

describe("商品註記選取", () => {
  it("單選群組會取代同群組舊選項並保留其他群組", () => {
    expect(toggleNoteOption(["mild", "egg"], single, "hot")).toEqual(["egg", "hot"]);
  });

  it("複選群組不允許超過上限", () => {
    expect(toggleNoteOption(["egg", "cheese"], multiple, "basil")).toEqual(["egg", "cheese"]);
  });

  it("驗證必選規則並依選項加總價格", () => {
    expect(noteSelectionIsValid([single, multiple], ["egg"])).toBe(false);
    expect(noteSelectionIsValid([single, multiple], ["hot", "egg"])).toBe(true);
    expect(notePriceAdjustment([single, multiple], ["hot", "egg"])).toBe(25);
  });
});
