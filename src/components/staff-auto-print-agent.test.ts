import { describe, expect, it } from "vitest";
import type { PrintQueueState } from "@/lib/print-center-types";
import { hasAutomaticPrintRule } from "./staff-auto-print-agent";

describe("StaffAutoPrintAgent rule readiness", () => {
  it("requires an enabled auto-print rule assigned to the active printer", () => {
    const state = {
      rules: [
        { printerId: "printer-a", isEnabled: true, autoPrint: false },
        { printerId: "printer-b", isEnabled: true, autoPrint: true },
      ],
    } as PrintQueueState;

    expect(hasAutomaticPrintRule(state, "printer-a")).toBe(false);
    expect(hasAutomaticPrintRule(state, "printer-b")).toBe(true);
  });
});
