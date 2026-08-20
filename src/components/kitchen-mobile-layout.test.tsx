import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KitchenBoard } from "@/components/kitchen-board";
import { KitchenNavigation } from "@/components/kitchen-navigation";
import { LocaleProvider } from "@/components/locale-provider";

vi.mock("@/components/work-mode-switcher", () => ({
  WorkModeSwitcher: () => <div data-testid="mock-work-mode-switcher" />,
}));
vi.mock("@/components/pwa-controls", () => ({ PwaControls: () => null }));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));

describe("kitchen mobile layout", () => {
  it("renders the primary navigation as equal icon-only mobile segments", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <KitchenNavigation
          active="BOARD"
          stall={{
            id: "11111111-1111-4111-8111-111111111111",
            organizationId: "22222222-2222-4222-8222-222222222222",
            slug: "demo",
            name: "測試攤位",
          }}
          availableStalls={[{ slug: "demo", name: "測試攤位" }]}
          canManage
          workModeDestinations={[]}
        />
      </LocaleProvider>,
    );

    expect(html).toContain('data-testid="kitchen-primary-navigation"');
    expect(html).toContain("grid-flow-col auto-cols-fr");
    expect(html).toContain("sr-only sm:not-sr-only");
  });

  it("renders equal three-mode controls and an icon utility toolbar", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <KitchenBoard
          stall={{ slug: "demo", name: "測試攤位" }}
          initialData={{
            settings: {
              warningMinutes: 10,
              criticalMinutes: 20,
              defaultView: "ORDER",
              timeZone: "Asia/Taipei",
              businessDayCutoffHour: 0,
            },
            stations: [],
            tasks: [],
            futureReservations: [],
            serverNow: "2026-08-20T10:00:00.000Z",
          }}
          role="KITCHEN"
        />
      </LocaleProvider>,
    );

    expect(html).toContain('data-testid="kitchen-mode-selector"');
    expect(html).toContain("w-full grid-cols-3");
    expect(html).toContain('data-testid="kitchen-utility-toolbar"');
    expect(html).toContain('role="status"');
    expect(html).toContain("sr-only sm:not-sr-only");
  });
});
