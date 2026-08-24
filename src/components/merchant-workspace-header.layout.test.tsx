import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
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
  it("collapses only the selectors while keeping a sticky horizontal function row", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <MerchantWorkspaceHeader
          workspaces={[workspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling={false}
        />
      </LocaleProvider>,
    );

    expect(html).toContain('id="merchant-mobile-options"');
    expect(html).toContain('data-testid="merchant-function-navigation-mobile"');
    expect(html).toContain('data-testid="merchant-function-navigation-desktop"');
    expect(html).toContain("sticky top-0");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('href="/merchant/dashboard?organizationId=organization-1"');
    expect(html).not.toContain("/merchant/billing?");
    expect(html).not.toContain("/merchant/payments?");
  });

  it("shows billing navigation only after the platform switch is enabled", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <MerchantWorkspaceHeader
          workspaces={[workspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling
        />
      </LocaleProvider>,
    );

    expect(html).toContain("/merchant/billing?");
  });

  it("shows payment navigation only after the platform module switch is enabled", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <MerchantWorkspaceHeader
          workspaces={[workspace]}
          displayName="店主"
          routeContext={{ organizationId: workspace.id, stallId: null }}
          showBilling={false}
          showPayments
        />
      </LocaleProvider>,
    );

    expect(html).toContain("/merchant/payments?");
  });
});
