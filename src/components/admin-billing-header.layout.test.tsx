import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { AdminBillingHeader } from "@/components/admin-billing-header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/billing",
}));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));

describe("AdminBillingHeader responsive navigation", () => {
  it("keeps readable primary links and a searchable grouped desktop sidebar", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <AdminBillingHeader displayName="平台管理員" />
      </LocaleProvider>,
    );

    expect(html).toContain('aria-label="平台管理導覽"');
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("min-w-0");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("workspace-function-link");
    expect(html).toContain('data-testid="admin-function-sidebar"');
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('title="帳務總覽"');
    expect(html).not.toContain('title="付款審核"');
    expect(html).not.toContain('title="外送整合"');
  });

  it("shows gated operational modules only when a platform administrator exposes them", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <AdminBillingHeader
          displayName="平台管理員"
          moduleVisibility={{ delivery: true, payments: true }}
        />
      </LocaleProvider>,
    );

    expect(html).toContain('title="付款審核"');
    expect(html).toContain('title="外送整合"');
    expect(html).toContain('title="付款整合"');
  });
});
