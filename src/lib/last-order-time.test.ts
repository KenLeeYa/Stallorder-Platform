import { expect, it } from "vitest";
import { businessHoursSchema } from "./business-hours";
import { specialClosureCommandSchema } from "./special-closures";
import { validLastOrderTime } from "./last-order-time";

it("validates cutoff against daytime and overnight business windows", () => {
  expect(validLastOrderTime("17:00", "19:00", "18:40")).toBe(true);
  expect(validLastOrderTime("17:00", "19:00", "19:30")).toBe(false);
  expect(validLastOrderTime("22:00", "02:00", "01:40")).toBe(true);
  expect(validLastOrderTime("22:00", "02:00", "20:00")).toBe(false);
});
it("saves cutoff with weekly and special hours and rejects invalid values", () => {
  const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, opensAt: "17:00", closesAt: "19:00", lastOrderAt: "18:40", isClosed: false }));
  expect(businessHoursSchema.safeParse({ hours }).success).toBe(true);
  expect(businessHoursSchema.safeParse({ hours: hours.map((hour) => ({ ...hour, lastOrderAt: "20:00" })) }).success).toBe(false);
  const special = { operation: "CREATE", startsOn: "2026-09-08", endsOn: "2026-09-08", opensAt: "12:00", closesAt: "15:00", lastOrderAt: "14:40", title: "特殊營業", message: "" };
  expect(specialClosureCommandSchema.safeParse(special).success).toBe(true);
  expect(specialClosureCommandSchema.safeParse({ ...special, lastOrderAt: "15:30" }).success).toBe(false);
});
