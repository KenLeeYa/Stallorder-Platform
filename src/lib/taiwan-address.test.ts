import { describe, expect, it } from "vitest";
import { isTaiwanCity, taiwanCityOptions } from "./taiwan-address";

describe("taiwan address options", () => {
  it("contains all Taiwan county and city level options", () => {
    expect(taiwanCityOptions).toHaveLength(22);
    expect(isTaiwanCity("臺北市")).toBe(true);
    expect(isTaiwanCity("不存在縣市")).toBe(false);
  });
});
