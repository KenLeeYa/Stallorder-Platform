import { describe, expect, it } from "vitest";
import { resolveStaffStartStep } from "@/components/staff-start-reminder-state";

describe("staff start reminder sequence", () => {
  it("asks for attendance before cash opening", () => {
    expect(resolveStaffStartStep({
      attendanceAvailable: true,
      attendanceState: "CLOCKED_OUT",
      attendanceHandled: false,
      cashShiftAvailable: true,
      hasOpenCashShift: false,
    })).toBe("ATTENDANCE");
  });

  it("moves directly to cash opening after attendance is handled", () => {
    expect(resolveStaffStartStep({
      attendanceAvailable: true,
      attendanceState: "CLOCKED_OUT",
      attendanceHandled: true,
      cashShiftAvailable: true,
      hasOpenCashShift: false,
    })).toBe("CASH_SHIFT");
  });

  it("does not interrupt work when both prerequisites are already satisfied", () => {
    expect(resolveStaffStartStep({
      attendanceAvailable: true,
      attendanceState: "CLOCKED_IN",
      attendanceHandled: false,
      cashShiftAvailable: true,
      hasOpenCashShift: true,
    })).toBe(null);
  });

  it("skips features that are disabled or unavailable to the role", () => {
    expect(resolveStaffStartStep({
      attendanceAvailable: false,
      attendanceState: null,
      attendanceHandled: false,
      cashShiftAvailable: false,
      hasOpenCashShift: false,
    })).toBe(null);
  });
});
