export type PayrollPolicyInput = {
  regularDayMinutes: number;
  roundingIncrementMinutes: number;
  overtimeTier1Minutes: number;
  overtimeTier1MultiplierBps: number;
  overtimeTier2MultiplierBps: number;
  defaultHolidayMultiplierBps: number;
};

export type PayrollShiftInput = {
  id: string;
  profileId: string;
  profileName: string;
  stallId: string;
  stallName: string;
  workDate: string;
  workedMinutes: number;
  unpaidBreakMinutes: number;
  dayType: "WORKDAY" | "REST_DAY" | "REGULAR_DAY_OFF" | "NATIONAL_HOLIDAY";
  holidayMultiplierBps?: number;
  hourlyRate: number | null;
};

export type PayrollLinePreview = {
  profileId: string;
  profileName: string;
  hourlyRate: number;
  regularMinutes: number;
  overtimeTier1Minutes: number;
  overtimeTier2Minutes: number;
  holidayMinutes: number;
  regularAmount: number;
  overtimeAmount: number;
  holidayAmount: number;
  grossAmount: number;
  missingWageRate: boolean;
  shifts: Array<PayrollShiftInput & { payableMinutes: number; grossAmount: number }>;
};

export function roundWorkedMinutes(minutes: number, increment: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.max(0, Math.round(minutes / increment) * increment);
}

function wageForMinutes(hourlyRate: number, minutes: number, multiplierBps = 10_000) {
  return Math.round((hourlyRate * minutes * multiplierBps) / 60 / 10_000);
}

export function calculatePayrollLines(
  shifts: PayrollShiftInput[],
  policy: PayrollPolicyInput,
): PayrollLinePreview[] {
  const grouped = new Map<string, PayrollLinePreview>();
  for (const shift of shifts) {
    const hourlyRate = shift.hourlyRate ?? 0;
    const worked = roundWorkedMinutes(shift.workedMinutes, policy.roundingIncrementMinutes);
    const payable = Math.max(0, worked - shift.unpaidBreakMinutes);
    const holiday = shift.dayType === "NATIONAL_HOLIDAY";
    const regularMinutes = holiday ? 0 : Math.min(payable, policy.regularDayMinutes);
    const overtimeTotal = holiday ? 0 : Math.max(0, payable - regularMinutes);
    const overtimeTier1Minutes = Math.min(overtimeTotal, policy.overtimeTier1Minutes);
    const overtimeTier2Minutes = Math.max(0, overtimeTotal - overtimeTier1Minutes);
    const holidayMinutes = holiday ? payable : 0;
    const regularAmount = wageForMinutes(hourlyRate, regularMinutes);
    const overtimeAmount = wageForMinutes(
      hourlyRate,
      overtimeTier1Minutes,
      policy.overtimeTier1MultiplierBps,
    ) + wageForMinutes(
      hourlyRate,
      overtimeTier2Minutes,
      policy.overtimeTier2MultiplierBps,
    );
    const holidayAmount = wageForMinutes(
      hourlyRate,
      holidayMinutes,
      shift.holidayMultiplierBps ?? policy.defaultHolidayMultiplierBps,
    );
    const grossAmount = regularAmount + overtimeAmount + holidayAmount;
    const line = grouped.get(shift.profileId) ?? {
      profileId: shift.profileId,
      profileName: shift.profileName,
      hourlyRate,
      regularMinutes: 0,
      overtimeTier1Minutes: 0,
      overtimeTier2Minutes: 0,
      holidayMinutes: 0,
      regularAmount: 0,
      overtimeAmount: 0,
      holidayAmount: 0,
      grossAmount: 0,
      missingWageRate: shift.hourlyRate === null,
      shifts: [],
    };
    line.hourlyRate = Math.max(line.hourlyRate, hourlyRate);
    line.regularMinutes += regularMinutes;
    line.overtimeTier1Minutes += overtimeTier1Minutes;
    line.overtimeTier2Minutes += overtimeTier2Minutes;
    line.holidayMinutes += holidayMinutes;
    line.regularAmount += regularAmount;
    line.overtimeAmount += overtimeAmount;
    line.holidayAmount += holidayAmount;
    line.grossAmount += grossAmount;
    line.missingWageRate ||= shift.hourlyRate === null;
    line.shifts.push({ ...shift, payableMinutes: payable, grossAmount });
    grouped.set(shift.profileId, line);
  }
  return [...grouped.values()].sort((left, right) => left.profileName.localeCompare(right.profileName, "zh-TW"));
}
