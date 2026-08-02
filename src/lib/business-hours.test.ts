import { describe, expect, it } from "vitest";
import { businessHoursSchema, getBusinessHoursFieldErrors } from "@/lib/business-hours";

describe("business hours field errors", () => {
  it("identifies the day and time control for every invalid value", () => {
    const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      opensAt: dayOfWeek === 0 ? "9:00" : "09:00",
      closesAt: dayOfWeek === 2 ? "24:00" : "18:00",
      isClosed: false,
    }));
    const result = businessHoursSchema.safeParse({ hours });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(getBusinessHoursFieldErrors(result.error)).toEqual({
      "hours.0.opensAt": "星期日開始時間格式必須為 HH:mm。",
      "hours.2.closesAt": "星期二結束時間格式必須為 HH:mm。",
    });
  });

  it("allows disabled time controls on closed days and normalizes legal database values", () => {
    const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      opensAt: dayOfWeek === 1 ? "" : "09:00",
      closesAt: dayOfWeek === 1 ? null : "18:00",
      isClosed: dayOfWeek === 1,
    }));
    const result = businessHoursSchema.safeParse({ hours });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.hours[1]).toMatchObject({
      dayOfWeek: 1,
      opensAt: "00:00",
      closesAt: "00:00",
      isClosed: true,
    });
  });
});
