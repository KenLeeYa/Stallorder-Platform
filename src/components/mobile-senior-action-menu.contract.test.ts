import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

const menuSource = source("./mobile-senior-action-menu.tsx");
const merchantSource = source("./merchant-workspace-header.tsx");
const staffSource = source("./staff-order-board-presentation.tsx");
const kitchenSource = source("./kitchen-navigation.tsx");
const globalStyles = source("../app/globals.css");

describe("mobile senior action menu contract", () => {
  it("keeps one shared navigation and promotes it into an accessible overlay only on mobile", () => {
    expect(menuSource).toContain("shouldUseMobileSeniorMenu(mode, mobile)");
    expect(menuSource).toContain('role="dialog"');
    expect(menuSource).toContain('aria-modal="true"');
    expect(menuSource).toContain('event.key === "Escape"');
    expect(menuSource).toContain('data-testid="senior-action-menu-launcher"');
  });

  it("covers merchant, staff, and kitchen navigation without duplicating their permissions", () => {
    expect(merchantSource).toContain('<MobileSeniorActionMenu label={m("商戶功能")}');
    expect(staffSource).toContain('<MobileSeniorActionMenu label={t("staff.functions")}');
    expect(kitchenSource).toContain('<MobileSeniorActionMenu label={t("kitchen.navigation")}');
  });

  it("uses two large action columns instead of a compressed horizontal toolbar", () => {
    expect(globalStyles).toContain(".senior-action-menu-content > nav");
    expect(globalStyles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(globalStyles).toContain("height: 6rem !important");
  });
});
