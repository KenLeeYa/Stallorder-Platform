import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MessageTestProvider } from "@/test/message-test-provider";
import { MerchantWorkspaceHeader } from "@/components/merchant-workspace-header";
import type { WorkspaceOrganization } from "@/lib/workspace";

vi.mock("next/navigation", () => ({
  usePathname: () => "/merchant/dashboard",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => "organization-1" }),
}));
vi.mock("@/components/pwa-controls", () => ({ PwaControls: () => null }));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));
vi.mock("@/components/work-mode-switcher", () => ({
  WorkModeSwitcher: ({ compactOnMobile }: { compactOnMobile?: boolean }) => (
    <div data-testid="mock-work-mode-switcher" data-compact={String(Boolean(compactOnMobile))} />
  ),
}));

const workspace: WorkspaceOrganization = {
  id: "organization-1",
  name: "測試商家",
  businessName: "測試商家",
  slug: "test-business",
  status: "ACTIVE",
  defaultCurrency: "TWD",
  operatingMode: "SINGLE_STALL",
  merchantSetupState: "COMPLETED",
  merchantSetupStallId: "stall-1",
  roles: ["ORGANIZATION_OWNER"],
  canUseAllStalls: true,
  stalls: [{
    id: "stall-1",
    organizationId: "organization-1",
    name: "測試攤位",
    slug: "test-stall",
    code: "TEST-STALL",
    businessStatus: "OPEN",
    orderingEnabled: true,
    kdsEnabled: false,
    isActive: true,
    roles: ["ORGANIZATION_OWNER"],
  }],
};

describe("MerchantWorkspaceHeader mobile layout", () => {
  it("keeps compact mode and stall tools visible without a collapsible selector panel", () => {
    const html = renderToStaticMarkup(
      <MessageTestProvider initialLocale="zh-TW">
        <MerchantWorkspaceHeader
          workspaces={[workspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling={false}
        />
      </MessageTestProvider>,
    );

    expect(html).not.toContain('id="merchant-mobile-options"');
    expect(html).toContain('data-testid="merchant-utility-toolbar"');
    expect(html).toContain('data-testid="merchant-function-navigation-mobile"');
    expect(html).toContain('data-testid="merchant-function-navigation-desktop"');
    expect(html).toContain('data-persist-horizontal-scroll="merchant-function-navigation-mobile"');
    expect(html).toContain('data-persist-horizontal-scroll="merchant-function-navigation-desktop"');
    expect(html).toContain('data-persist-horizontal-scroll="merchant-utility-toolbar"');
    const utilityToolbarClass = html.match(/data-testid="merchant-utility-toolbar"[^>]*class="([^"]+)"/)?.[1] ?? "";
    expect(utilityToolbarClass).toContain("flex-1");
    expect(utilityToolbarClass).not.toContain("shrink-0");
    const workspaceHeaderClass = html.match(/data-testid="merchant-workspace-header"[^>]*class="([^"]+)"/)?.[1] ?? "";
    expect(workspaceHeaderClass).toContain("overflow-x-clip");
    expect(html).toContain("sticky top-0");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("[&amp;_button]:h-11");
    expect(html).toContain("[&amp;_svg]:h-5");
    expect(html).toContain('data-compact="false"');
    expect(html).toContain('aria-label="選擇攤位：測試攤位"');
    expect(html).toContain('href="/merchant/test-stall"');
    expect(html).not.toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<select");
    expect(html).toContain('href="/merchant/dashboard?organizationId=organization-1"');
    expect(html).not.toContain("/merchant/billing?");
    expect(html).not.toContain("/merchant/payments?");
    expect(html).not.toContain("/merchant/supply?");
    expect(html).not.toContain("/merchant/growth?");
    expect(html).toContain("/merchant/reports/overview?");
  });

  it("opens the centered selector only when two or more active stalls are available", () => {
    const multiStallWorkspace: WorkspaceOrganization = {
      ...workspace,
      operatingMode: "MULTI_STALL",
      stalls: [
        ...workspace.stalls,
        {
          ...workspace.stalls[0],
          id: "stall-2",
          name: "第二攤位",
          slug: "second-stall",
          code: "SECOND-STALL",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <MessageTestProvider initialLocale="zh-TW">
        <MerchantWorkspaceHeader
          workspaces={[multiStallWorkspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling={false}
        />
      </MessageTestProvider>,
    );

    expect(html).toContain('aria-label="選擇攤位：全部攤位"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('href="/merchant/test-stall"');
    expect(html).toContain("/merchant/reports/overview?");
  });

  it("does not render an invalid stall destination when no active stall exists", () => {
    const inactiveWorkspace: WorkspaceOrganization = {
      ...workspace,
      stalls: workspace.stalls.map((stall) => ({ ...stall, isActive: false })),
    };
    const html = renderToStaticMarkup(
      <MessageTestProvider initialLocale="zh-TW">
        <MerchantWorkspaceHeader
          workspaces={[inactiveWorkspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling={false}
        />
      </MessageTestProvider>,
    );

    expect(html).not.toContain('aria-label="選擇攤位');
    expect(html).not.toContain('href="/merchant/test-stall"');
  });

  it("shows billing navigation only after the platform switch is enabled", () => {
    const html = renderToStaticMarkup(
      <MessageTestProvider initialLocale="zh-TW">
        <MerchantWorkspaceHeader
          workspaces={[workspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling
        />
      </MessageTestProvider>,
    );

    expect(html).toContain("/merchant/billing?");
  });

  it("shows payment navigation only after the platform module switch is enabled", () => {
    const html = renderToStaticMarkup(
      <MessageTestProvider initialLocale="zh-TW">
        <MerchantWorkspaceHeader
          workspaces={[workspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling={false}
          showPayments
        />
      </MessageTestProvider>,
    );

    expect(html).toContain("/merchant/payments?");
  });

  it("shows only enabled competitive modules in merchant navigation", () => {
    const html = renderToStaticMarkup(
      <MessageTestProvider initialLocale="zh-TW">
        <MerchantWorkspaceHeader
          workspaces={[workspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling={false}
          showGrowth
          showSupply
        />
      </MessageTestProvider>,
    );

    expect(html).toContain("/merchant/supply?");
    expect(html).toContain("/merchant/growth?");
    expect(html).toContain("lucide-users-round");
  });
});
