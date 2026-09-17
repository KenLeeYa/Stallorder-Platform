import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminLayout from "./layout";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/authorization", () => ({ requirePlatformAdminPage: mocks.requireAdmin }));
vi.mock("@/lib/app-locale-server", () => ({
  getRequestAppLocale: vi.fn(async () => ({ locale: "zh-TW" })),
}));
vi.mock("@/server/admin/admin-module-visibility", () => ({
  getAdminModuleVisibility: vi.fn(async () => ({ delivery: false, payments: false })),
}));
vi.mock("@/components/admin-billing-header", () => ({ AdminBillingHeader: () => null }));
vi.mock("@/lib/messages/merchant", () => ({ getMerchantMessages: () => ({}) }));
vi.mock("@/lib/messages/merchant-client", () => ({
  MerchantMessagesProvider: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.requireAdmin.mockResolvedValue({ user: { displayName: "Admin" } });
});

describe("AdminLayout login destination", () => {
  it("preserves the health page through the parent authorization check", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-stallorder-admin-return-path": "/admin/health" }));
    const layout = await AdminLayout({ children: <main>Health</main> });
    expect(mocks.requireAdmin).toHaveBeenCalledWith("/admin/health");
    expect(renderToString(layout)).toContain("Health");
  });

  it.each([undefined, "/admin/billing", "https://example.com", "//example.com", "/merchant"])(
    "keeps the existing billing destination for %s",
    async (path) => {
      mocks.headers.mockResolvedValue(new Headers(path ? { "x-stallorder-admin-return-path": path } : {}));
      await AdminLayout({ children: null });
      expect(mocks.requireAdmin).toHaveBeenCalledWith("/admin/billing");
    },
  );

  it("does not render the layout when the administrator check rejects the session", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    await expect(AdminLayout({ children: <main>Health</main> })).rejects.toThrow("UNAUTHORIZED");
  });
});
