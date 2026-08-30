export type StaffStartStep = "ATTENDANCE" | "CASH_SHIFT" | null;

export function resolveStaffStartStep(input: {
  attendanceAvailable: boolean;
  attendanceState: "CLOCKED_IN" | "CLOCKED_OUT" | null;
  attendanceHandled: boolean;
  cashShiftAvailable: boolean;
  hasOpenCashShift: boolean;
}): StaffStartStep {
  if (
    input.attendanceAvailable
    && input.attendanceState === "CLOCKED_OUT"
    && !input.attendanceHandled
  ) return "ATTENDANCE";
  if (input.cashShiftAvailable && !input.hasOpenCashShift) return "CASH_SHIFT";
  return null;
}
