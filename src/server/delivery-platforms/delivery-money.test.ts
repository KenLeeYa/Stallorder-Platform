import { describe, expect, it } from "vitest";
import {
  assertProviderMinorAmount,
  providerMajorAmountToInternalUnits,
} from "./delivery-money";

describe("delivery money normalization", () => {
  it("converts provider major units without floating point arithmetic", () => {
    expect(providerMajorAmountToInternalUnits("39.75", "USD")).toBe(3_975);
    expect(providerMajorAmountToInternalUnits(-1, "USD")).toBe(-100);
    expect(providerMajorAmountToInternalUnits(120, "TWD")).toBe(120);
  });

  it("rejects fractional whole-unit currency values and unsafe amounts", () => {
    expect(() => providerMajorAmountToInternalUnits("39.75", "TWD"))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_ERROR" }));
    expect(() => providerMajorAmountToInternalUnits("1e3", "USD"))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_ERROR" }));
    expect(() => assertProviderMinorAmount(1.5))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_ERROR" }));
  });
});
