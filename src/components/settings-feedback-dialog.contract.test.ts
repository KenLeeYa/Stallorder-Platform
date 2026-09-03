import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

describe("stall settings operation feedback", () => {
  it("uses one centered accessible feedback dialog", () => {
    const dialog = source("./settings-feedback-dialog.tsx");

    expect(dialog).toContain('role={kind === "error" ? "alertdialog" : "dialog"}');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain("fixed inset-0");
    expect(dialog).toContain("focus");
    expect(dialog).toContain('event.key === "Escape"');
  });

  it("replaces transient inline messages in every stall settings editor", () => {
    const settingEditors = [
      "./stall-editor.tsx",
      "./stall-business-hours-manager.tsx",
      "./stall-special-closures-manager.tsx",
      "./stall-modules-manager.tsx",
      "./stall-order-limits-form.tsx",
      "./stall-template-copy-manager.tsx",
      "./stall-team-manager.tsx",
      "./stall-alert-sound-settings.tsx",
      "./stall-catalog-settings.tsx",
    ];

    for (const fileName of settingEditors) {
      expect(source(fileName), fileName).toContain("<SettingsFeedbackDialog");
    }
  });
});
