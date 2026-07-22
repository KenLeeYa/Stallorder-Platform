import { describe, expect, it } from "vitest";
import { canTransitionSchedule } from "@/lib/stall-schedules";

describe("stall schedule transitions", () => {
  it("permits only explicit operational transitions", () => {
    expect(canTransitionSchedule("SCHEDULED", "OPEN")).toBe(true);
    expect(canTransitionSchedule("SCHEDULED", "DELAYED")).toBe(true);
    expect(canTransitionSchedule("DELAYED", "OPEN")).toBe(true);
    expect(canTransitionSchedule("OPEN", "COMPLETED")).toBe(true);
    expect(canTransitionSchedule("COMPLETED", "OPEN")).toBe(false);
    expect(canTransitionSchedule("CANCELLED", "OPEN")).toBe(false);
  });
});
