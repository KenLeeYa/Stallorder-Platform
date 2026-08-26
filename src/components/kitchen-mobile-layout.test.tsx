import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KitchenBoard } from "@/components/kitchen-board";
import { KitchenNavigation } from "@/components/kitchen-navigation";
import { LocaleProvider } from "@/components/locale-provider";

vi.mock("@/components/work-mode-switcher", () => ({
  WorkModeSwitcher: () => <div data-testid="mock-work-mode-switcher" />,
}));
vi.mock("@/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="mock-workspace-switcher" />,
}));
vi.mock("@/components/pwa-controls", () => ({
  PwaControls: ({ showLocale = true, showQualityLabel = true }: { showLocale?: boolean; showQualityLabel?: boolean }) => (
    <div
      data-testid="mock-pwa-controls"
      data-show-locale={String(showLocale)}
      data-show-quality-label={String(showQualityLabel)}
    />
  ),
}));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => <div data-testid="mock-logout-button" /> }));

describe("kitchen mobile layout", () => {
  it("renders every kitchen header control in one ordered row", () => {
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
          availableStalls={[
            { slug: "demo", name: "測試攤位" },
            { slug: "demo-2", name: "第二攤位" },
          ]}
          canManage
          workModeDestinations={[
            { value: "merchant:22222222-2222-4222-8222-222222222222", mode: "MERCHANT", organizationId: "22222222-2222-4222-8222-222222222222", stallId: null, label: "商家管理", href: "/merchant/dashboard" },
            { value: "kitchen:11111111-1111-4111-8111-111111111111", mode: "KITCHEN", organizationId: "22222222-2222-4222-8222-222222222222", stallId: "11111111-1111-4111-8111-111111111111", label: "廚房 · 測試攤位", href: "/kitchen?stall=demo" },
            { value: "kitchen:33333333-3333-4333-8333-333333333333", mode: "KITCHEN", organizationId: "22222222-2222-4222-8222-222222222222", stallId: "33333333-3333-4333-8333-333333333333", label: "廚房 · 第二攤位", href: "/kitchen?stall=demo-2" },
          ]}
        />
      </LocaleProvider>,
    );

    expect(html).toContain('data-testid="kitchen-toolbar-row"');
    expect(html).toContain('data-testid="kitchen-primary-navigation"');
    expect(html).toContain('data-testid="kitchen-utility-toolbar"');
    expect(html).toContain('data-testid="kitchen-language-control"');
    expect(html).toContain('data-testid="kitchen-pinned-logout"');
    expect(html).toContain('data-testid="mock-work-mode-switcher"');
    expect(html).toContain('data-testid="mock-workspace-switcher"');
    expect(html.match(/data-testid="mock-pwa-controls"/g)).toHaveLength(1);
    expect(html).toContain('data-show-locale="false"');
    expect(html).toContain('data-show-quality-label="false"');
    expect(html.match(/data-testid="mock-logout-button"/g)).toHaveLength(1);
    expect(html).toContain("sticky top-0");
    expect(html).toContain("h-16");
    expect(html).not.toContain("md:h-28");
    expect(html).not.toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("grid h-11 w-11");
    expect(html).toContain("<span class=\"sr-only\">生產看板</span>");

    const boardIndex = html.indexOf('data-testid="kitchen-nav-board"');
    const stationsIndex = html.indexOf('data-testid="kitchen-nav-stations"');
    const languageIndex = html.indexOf('data-testid="kitchen-language-control"');
    const settingsIndex = html.indexOf('data-testid="kitchen-nav-settings"');
    const logoutIndex = html.indexOf('data-testid="kitchen-pinned-logout"');
    expect(boardIndex).toBeGreaterThan(-1);
    expect(stationsIndex).toBeGreaterThan(boardIndex);
    expect(languageIndex).toBeGreaterThan(stationsIndex);
    expect(settingsIndex).toBeGreaterThan(languageIndex);
    expect(logoutIndex).toBeGreaterThan(settingsIndex);
  });

  it("hides both switchers for a pure kitchen account", () => {
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
          canManage={false}
          workModeDestinations={[
            { value: "kitchen:11111111-1111-4111-8111-111111111111", mode: "KITCHEN", organizationId: "22222222-2222-4222-8222-222222222222", stallId: "11111111-1111-4111-8111-111111111111", label: "廚房 · 測試攤位", href: "/kitchen?stall=demo" },
          ]}
        />
      </LocaleProvider>,
    );

    expect(html).not.toContain('data-testid="mock-work-mode-switcher"');
    expect(html).not.toContain('data-testid="mock-workspace-switcher"');
  });

  it("shows work mode but not stall switching for a single-stall merchant", () => {
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
          workModeDestinations={[
            { value: "merchant:22222222-2222-4222-8222-222222222222", mode: "MERCHANT", organizationId: "22222222-2222-4222-8222-222222222222", stallId: null, label: "商家管理", href: "/merchant/dashboard" },
            { value: "kitchen:11111111-1111-4111-8111-111111111111", mode: "KITCHEN", organizationId: "22222222-2222-4222-8222-222222222222", stallId: "11111111-1111-4111-8111-111111111111", label: "廚房 · 測試攤位", href: "/kitchen?stall=demo" },
          ]}
        />
      </LocaleProvider>,
    );

    expect(html).toContain('data-testid="mock-work-mode-switcher"');
    expect(html).not.toContain('data-testid="mock-workspace-switcher"');
  });

  it("renders only board-specific controls in the sticky board toolbar", () => {
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
    expect(html).toContain("inline-grid h-11 grid-cols-3");
    expect(html).toContain("grid h-11 w-11");
    expect(html).toContain('data-testid="kitchen-board-utility-toolbar"');
    expect(html).not.toContain('data-testid="mock-pwa-controls"');
    expect(html).not.toContain('data-testid="mock-logout-button"');
    expect(html).toContain("sticky top-16");
    expect(html).not.toContain("md:top-28");
    expect(html).toContain('role="status"');
    expect(html).toContain("<span class=\"sr-only\">訂單</span>");
  });
});
