import { describe, expect, it } from "vitest";
import { calculatePayrollLines, roundWorkedMinutes } from "@/server/workforce/workforce-calculator";

const policy = {
  regularDayMinutes: 480,
  roundingIncrementMinutes: 5,
  overtimeTier1Minutes: 120,
  overtimeTier1MultiplierBps: 13_333,
  overtimeTier2MultiplierBps: 16_667,
  defaultHolidayMultiplierBps: 20_000,
};

function shift(overrides: Partial<Parameters<typeof calculatePayrollLines>[0][number]> = {}) {
  return {
    id: "shift-1",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileName: "測試員工",
    stallId: "22222222-2222-4222-8222-222222222222",
    stallName: "測試攤位",
    workDate: "2026-08-29",
    workedMinutes: 540,
    unpaidBreakMinutes: 60,
    dayType: "WORKDAY" as const,
    hourlyRate: 200,
    ...overrides,
  };
}

describe("workforce payroll calculator", () => {
  it("rounds attendance minutes to the configured increment", () => {
    expect(roundWorkedMinutes(482, 5)).toBe(480);
    expect(roundWorkedMinutes(483, 5)).toBe(485);
  });

  it("deducts unpaid breaks before calculating regular and overtime wages", () => {
    const [line] = calculatePayrollLines([shift()], policy);
    expect(line.regularMinutes).toBe(480);
    expect(line.overtimeTier1Minutes).toBe(0);
    expect(line.grossAmount).toBe(1_600);
  });

  it("applies both overtime tiers without changing the wage snapshot", () => {
    const [line] = calculatePayrollLines([
      shift({ workedMinutes: 720, unpaidBreakMinutes: 0 }),
    ], policy);
    expect(line.regularMinutes).toBe(480);
    expect(line.overtimeTier1Minutes).toBe(120);
    expect(line.overtimeTier2Minutes).toBe(120);
    expect(line.regularAmount).toBe(1_600);
    expect(line.overtimeAmount).toBe(1_200);
    expect(line.grossAmount).toBe(2_800);
  });

  it("uses an explicit holiday multiplier and flags missing wage rates", () => {
    const [holiday] = calculatePayrollLines([
      shift({ dayType: "NATIONAL_HOLIDAY", holidayMultiplierBps: 25_000, workedMinutes: 480, unpaidBreakMinutes: 0 }),
    ], policy);
    expect(holiday.holidayMinutes).toBe(480);
    expect(holiday.holidayAmount).toBe(4_000);

    const [missing] = calculatePayrollLines([shift({ hourlyRate: null })], policy);
    expect(missing.missingWageRate).toBe(true);
    expect(missing.grossAmount).toBe(0);
  });
});
