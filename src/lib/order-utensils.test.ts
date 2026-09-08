import { describe, expect, it } from "vitest";
import { readOrderUtensils, writeOrderUtensils } from "./order-utensils";

describe("utensils preference carried with the order note", () => {
  it("preserves free text through selection, restoration, editing and removal", () => {
    const note = "不加辣\n請分袋";
    const selected = writeOrderUtensils(note, true);
    expect(readOrderUtensils(selected)).toEqual({ required: true, note });
    expect(writeOrderUtensils(selected, true)).toBe(selected);
    expect(writeOrderUtensils(selected, false)).toBe(note);
    expect(readOrderUtensils(note)).toEqual({ required: false, note });
  });
  it("leaves text inside a customer's note intact and represents a request without free text", () => {
    const original = "店家上次說【免洗餐具：需要】";
    expect(readOrderUtensils(original).note).toBe(original);
    expect(readOrderUtensils(writeOrderUtensils("", true))).toEqual({ required: true, note: "" });
  });
});
