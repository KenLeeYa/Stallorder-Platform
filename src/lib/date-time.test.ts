import { describe, expect, it } from "vitest";
import { formatTaipeiDateTime } from "./date-time";

describe("台北時間格式", () => {
  it("在伺服器與瀏覽器皆產生固定格式", () => {
    expect(formatTaipeiDateTime("2026-07-15T17:55:23.000Z")).toBe("2026/07/16 01:55:23");
  });
});
