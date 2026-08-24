import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { AdminBillingHeader } from "@/components/admin-billing-header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/billing",
}));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));

describe("AdminBillingHeader responsive navigation", () => {
  it("keeps accessible labels while showing compact icon buttons on mobile", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <AdminBillingHeader displayName="平台管理員" />
      </LocaleProvider>,
    );

    expect(html).toContain('aria-label="平台管理導覽"');
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("min-w-0");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("h-11 w-11");
    expect(html).toContain("md:w-auto");
    expect(html).toContain("sr-only md:not-sr-only md:inline");
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
