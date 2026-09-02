import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./workforce-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("workforce large action flow", () => {
  it("uses one large entry card for each scheduling and payroll setup workflow", () => {
    expect(source).toContain("WorkforceActionCard");
    expect(source).toContain('testId="open-workforce-wage"');
    expect(source).toContain('testId="open-workforce-schedule"');
    expect(source).toContain('testId="open-workforce-holiday"');
    expect(source).toContain('testId="open-workforce-policy"');
    expect(source).toContain("min-h-28");
  });

  it("opens each form in an accessible touch-friendly overlay", () => {
    expect(source).toContain("WorkforceActionDialog");
    expect(source).toContain('data-testid="workforce-action-dialog"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('hidden={activeAction !== "wage"}');
    expect(source).toContain('hidden={activeAction !== "policy"}');
    expect(source).not.toContain("<details");
  });
});
