import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./product-note-groups-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("product note compact action hierarchy", () => {
  it("shows both large note entry buttons without the duplicate toolbar or tabs", () => {
    expect(source).toContain('data-testid="product-note-entry-actions"');
    expect(source).toContain('data-testid="open-reusable-note-navigator"');
    expect(source).toContain('data-testid="open-note-group-navigator"');
    expect(source).not.toContain('data-testid="product-note-tools"');
    expect(source).not.toContain('role="tablist"');
    expect(source).not.toContain('role="tab"');
  });

  it("opens reusable single notes in the same large hierarchical navigator", () => {
    expect(source).toContain('data-testid="open-reusable-note-navigator"');
    expect(source).toContain('testId="reusable-note-navigator-dialog"');
    expect(source).toContain("ReusableProductNoteCard");
    expect(source).toContain("visibleNavigatorReusableNotes");
    expect(source).not.toContain('className="mt-5 divide-y divide-stone-200 border-y border-stone-200"');
  });

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
    expect(source).toContain('data-testid="reusable-note-action-trigger"');
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
