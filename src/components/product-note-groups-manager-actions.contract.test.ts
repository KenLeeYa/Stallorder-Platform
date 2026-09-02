import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./product-note-groups-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("product note compact action hierarchy", () => {
  it("opens note groups in one large hierarchical navigator instead of a long disclosure list", () => {
    expect(source).toContain('data-testid="open-note-group-navigator"');
    expect(source).toContain('testId="note-group-navigator-dialog"');
    expect(source).toContain("ProductNoteGroupCard");
    expect(source).toContain("ProductNoteOptionCard");
    expect(source).toContain("fullScreen");
    expect(source).not.toContain('id="product-note-groups-list"');
  });

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

  it("uses large touch switches for note, group, and product selection", () => {
    expect(source).toContain('role="switch"');
    expect(source).toContain('aria-checked={checked}');
    expect(source).toContain('min-h-14');
    expect(source).toContain("點選大型開關");
    expect(source).not.toContain('type="checkbox"');
  });
});
