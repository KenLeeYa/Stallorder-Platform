import type { UserRole } from "@prisma/client";
import { hasPermission } from "@/lib/rbac";

export type StaffStartStep = "ATTENDANCE" | "CASH_SHIFT" | null;

export function staffStartReminderPolicy(role: UserRole) {
  return {
    attendanceRequired: role === "STAFF",
    cashShiftRequired: hasPermission(role, "MANAGE_CASH_SHIFT"),
  };
}

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
