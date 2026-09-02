import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

describe("special business hours UI contract", () => {
  it("offers closed-all-day and opening-window modes for single or multiple dates", () => {
    const manager = source("./stall-special-closures-manager.tsx");
    expect(manager).toContain('mode: "CLOSED" | "OPEN_HOURS"');
    expect(manager).toContain('type="time"');
    expect(manager).toContain("opensAt");
    expect(manager).toContain("closesAt");
    expect(manager).toContain("特殊營業時間");
    expect(manager).toContain("日期區間");
  });

  it("opens a touch-friendly editor for existing rows and rejects overlapping dates", () => {
    const manager = source("./stall-special-closures-manager.tsx");
    expect(manager).toContain('role="dialog"');
    expect(manager).toContain('aria-modal="true"');
    expect(manager).toContain('operation: editingClosureId ? "UPDATE" : "CREATE"');
    expect(manager).toContain("此日期已設定特殊營業時間或店休");
    expect(manager).toContain("儲存變更");
    expect(manager).toContain("重設");
  });

  it("uses an in-app confirmation dialog before deleting an existing setting", () => {
    const manager = source("./stall-special-closures-manager.tsx");
    expect(manager).not.toContain("window.confirm");
    expect(manager).toContain("deleteConfirmationOpen");
    expect(manager).toContain('aria-labelledby="special-closure-delete-title"');
    expect(manager).toContain("確認刪除");
  });

  it("shares a localized once-per-setting reminder across QR ordering and the online menu", () => {
    const notice = source("./special-closure-notice-dialog.tsx");
    const qrFlow = source("./qr-order-flow-presentation.tsx");
    const publicMenu = source("../app/store/[identifier]/public-menu-view.tsx");

    expect(notice).toContain("sessionStorage");
    expect(notice).toContain("dateInTimeZone");
    expect(notice).toContain('role="dialog"');
    expect(notice).toContain('aria-modal="true"');
    expect(qrFlow).toContain("SpecialClosureNoticeDialog");
    expect(publicMenu).toContain("SpecialClosureNoticeDialog");
  });
});
