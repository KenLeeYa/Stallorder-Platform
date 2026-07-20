import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let cashShiftCommandSchema: typeof import("@/lib/cash-shifts").cashShiftCommandSchema;

beforeAll(async () => {
  ({ cashShiftCommandSchema } = await import("@/lib/cash-shifts"));
});

describe("cash shift command contract", () => {
  it("accepts opening and approved review commands", () => {
    expect(cashShiftCommandSchema.safeParse({ operation: "OPEN", openingAmount: 2000 }).success).toBe(true);
    expect(cashShiftCommandSchema.safeParse({
      operation: "REVIEW",
      shiftId: "84100000-0000-4000-8000-000000000001",
      decision: "APPROVED",
    }).success).toBe(true);
  });

  it("requires reasons for manual movement and non-approved review", () => {
    expect(cashShiftCommandSchema.safeParse({
      operation: "MOVE",
      shiftId: "84100000-0000-4000-8000-000000000001",
      type: "CASH_OUT",
      amount: 100,
      reason: "",
    }).success).toBe(false);
    expect(cashShiftCommandSchema.safeParse({
      operation: "REVIEW",
      shiftId: "84100000-0000-4000-8000-000000000001",
      decision: "ADJUSTMENT_REQUIRED",
    }).success).toBe(false);
  });

  it("rejects zero corrections and mass-assigned fields", () => {
    expect(cashShiftCommandSchema.safeParse({
      operation: "ADJUST",
      shiftId: "84100000-0000-4000-8000-000000000001",
      amount: 0,
      reason: "更正",
    }).success).toBe(false);
    expect(cashShiftCommandSchema.safeParse({
      operation: "OPEN",
      openingAmount: 1000,
      organizationId: "11111111-1111-4111-8111-111111111111",
    }).success).toBe(false);
  });
});
