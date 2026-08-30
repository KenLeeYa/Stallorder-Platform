import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./product-note-groups-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("product note compact action hierarchy", () => {
  it("uses one ellipsis trigger for reusable notes, groups, and group options", () => {
    expect(source).toContain("MoreHorizontal");
    expect(source).toContain("setNoteActionTarget");
    expect(source).toContain('testId="reusable-note-action-trigger"');
    expect(source).toContain('testId="note-group-action-trigger"');
    expect(source).toContain('testId="note-option-action-trigger"');
  });

  it("opens the detailed actions in the existing centered accessible editor", () => {
    expect(source).toContain('data-testid="product-note-action-dialog"');
    expect(source).toContain("ProductNoteActionButton");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
  });
});
