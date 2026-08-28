import { describe, expect, it } from "vitest";
import { leaveRequestCommandSchema, workforceManagerCommandSchema } from "@/server/workforce/workforce-contract";

const profileId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

describe("workforce contracts", () => {
  it("accepts an effective wage rate and a complete scheduled shift", () => {
    expect(workforceManagerCommandSchema.parse({
      operation: "SET_WAGE_RATE",
      profileId,
      stallId,
      hourlyRate: 210,
      effectiveFrom: "2026-08-01",
    })).toMatchObject({ hourlyRate: 210 });

    expect(workforceManagerCommandSchema.parse({
      operation: "CREATE_SCHEDULE",
      profileId,
      stallId,
      workDate: "2026-08-30",
      shiftStartAt: "2026-08-30T09:00:00.000+08:00",
      shiftEndAt: "2026-08-30T18:00:00.000+08:00",
      unpaidBreakMinutes: 60,
      dayType: "WORKDAY",
    })).toMatchObject({ status: "PUBLISHED", unpaidBreakMinutes: 60 });
  });

  it("rejects a partial or reversed scheduled shift", () => {
    const partial = workforceManagerCommandSchema.safeParse({
      operation: "CREATE_SCHEDULE",
      profileId,
      stallId,
      workDate: "2026-08-30",
      shiftStartAt: "2026-08-30T09:00:00.000+08:00",
      unpaidBreakMinutes: 0,
      dayType: "WORKDAY",
    });
    expect(partial.success).toBe(false);

    const reversed = workforceManagerCommandSchema.safeParse({
      operation: "CREATE_SCHEDULE",
      profileId,
      stallId,
      workDate: "2026-08-30",
      shiftStartAt: "2026-08-30T18:00:00.000+08:00",
      shiftEndAt: "2026-08-30T09:00:00.000+08:00",
      unpaidBreakMinutes: 0,
      dayType: "WORKDAY",
    });
    expect(reversed.success).toBe(false);
  });

  it("bounds holiday multipliers and validates leave ranges", () => {
    expect(workforceManagerCommandSchema.safeParse({
      operation: "UPSERT_HOLIDAY",
      holidayDate: "2026-10-10",
      name: "國慶日",
      multiplierBps: 9_999,
    }).success).toBe(false);

    expect(leaveRequestCommandSchema.safeParse({
      operation: "CREATE_LEAVE_REQUEST",
      leaveType: "DAY_OFF",
      startDate: "2026-09-02",
      endDate: "2026-09-01",
    }).success).toBe(false);
  });

  it("accepts explicit schedule and leave cancellation commands", () => {
    expect(workforceManagerCommandSchema.parse({
      operation: "CANCEL_SCHEDULE",
      scheduleId: profileId,
    })).toMatchObject({ operation: "CANCEL_SCHEDULE" });
    expect(leaveRequestCommandSchema.parse({
      operation: "CANCEL_LEAVE_REQUEST",
      leaveRequestId: profileId,
    })).toMatchObject({ operation: "CANCEL_LEAVE_REQUEST" });
  });
});
