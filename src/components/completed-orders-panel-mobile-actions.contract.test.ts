import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./completed-orders-panel.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("completed order mobile actions", () => {
  it("renders payment correction, cancellation, and receipt as equal icon buttons on mobile", () => {
    for (const testId of [
      "completed-order-change-payment",
      "completed-order-cancel",
      "completed-order-print",
    ]) {
      expect(source).toContain(`data-testid="${testId}"`);
    }
    expect(source.match(/h-11 w-11/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source.match(/sr-only sm:not-sr-only/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
