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
const accessibilitySource = source("./accessibility-mode-toggle.tsx");
const compactSwitcherSource = source("./compact-switcher-dialog.tsx");
const localeSource = source("./locale-selector.tsx");
const logoutSource = source("./logout-button.tsx");
const offlineSource = source("./offline-bootstrap-control.tsx");
const pwaSource = source("./pwa-controls.tsx");
const capacitySource = source("./staff-capacity-control.tsx");
const themeSource = source("./theme-toggle.tsx");
const globalStyles = source("../app/globals.css");

describe("mobile senior action menu contract", () => {
  it("keeps one shared navigation and promotes it into an accessible overlay on phone and tablet", () => {
    expect(menuSource).toContain("shouldUseMobileSeniorMenu(mode, mobile)");
    expect(menuSource).toContain('const compactMediaQuery = "(max-width: 1023px)"');
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

  it("uses square responsive tiles with three phone columns and five tablet columns", () => {
    expect(menuSource).toContain("h-[calc(100dvh-1.5rem)]");
    expect(menuSource).toContain("sm:max-w-[calc(100vw-1.5rem)]");
    expect(globalStyles).toContain(".senior-action-menu-content > nav");
    expect(globalStyles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(globalStyles).toContain("@media (min-width: 640px) and (max-width: 1023px)");
    expect(globalStyles).toContain("--senior-action-tile-size");
    expect(globalStyles).toContain("grid-template-columns: repeat(5, var(--senior-action-tile-size))");
    expect(globalStyles).toContain("aspect-ratio: 1 / 1");
    expect(globalStyles).toContain('[data-testid="staff-function-identity-group"]');
    expect(globalStyles).toContain('[data-testid="staff-capacity-compact"]');
    expect(globalStyles).toContain('[data-testid="kitchen-language-control"]');
    expect(globalStyles).toContain('[data-testid="merchant-utility-toolbar"]');
  });

  it("marks every nested compact control as a full senior action tile", () => {
    expect(kitchenSource.match(/data-senior-action-tile="true"/g)).toHaveLength(8);
    expect(kitchenSource.match(/data-senior-action-container="true"/g)).toHaveLength(5);
    expect(kitchenSource).not.toContain("[&>label]:!h-11");
    expect(kitchenSource).not.toContain("[&_button]:!h-11");
    expect(kitchenSource).not.toContain("[&_span[title]]:!h-11");
    expect(accessibilitySource).toContain('data-senior-action-tile="true"');
    expect(compactSwitcherSource).toContain('data-senior-action-tile="true"');
    expect(localeSource).toContain('data-senior-action-tile="true"');
    expect(logoutSource).toContain('data-senior-action-tile="true"');
    expect(pwaSource.match(/data-senior-action-tile="true"/g)).toHaveLength(3);
    expect(capacitySource).toContain('data-senior-action-tile="true"');
    expect(themeSource).toContain('data-senior-action-tile="true"');
    expect(offlineSource).toContain('data-senior-action-container="true"');
    expect(offlineSource).toContain('data-senior-action-tile="true"');
    expect(globalStyles).toContain('[data-senior-action-container="true"]');
    expect(globalStyles).toContain('[data-senior-action-tile="true"]');
    expect(globalStyles).toContain("justify-self: stretch !important");
    expect(globalStyles).toContain("align-self: stretch !important");
  });
});
