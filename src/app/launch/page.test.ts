import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getPagePrincipal: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  getDefaultWorkspacePath: vi.fn(),
  getPendingMerchantSetupPath: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ getPagePrincipal: mocks.getPagePrincipal }));
vi.mock("@/lib/workspace", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
  getDefaultWorkspacePath: mocks.getDefaultWorkspacePath,
}));
vi.mock("@/server/merchant-applications/merchant-setup-service", () => ({
  getPendingMerchantSetupPath: mocks.getPendingMerchantSetupPath,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  });
  mocks.getPagePrincipal.mockResolvedValue({
    user: { id: "profile-1", platformRole: null },
  });
  mocks.getWorkspaceAccess.mockResolvedValue([{ id: "organization-1" }]);
  mocks.getDefaultWorkspacePath.mockReturnValue("/staff/demo-stall");
  mocks.getPendingMerchantSetupPath.mockResolvedValue(null);
});

describe("PWA launch routing", () => {
  it("sends an unauthenticated launch to login without changing session policy", async () => {
    mocks.getPagePrincipal.mockResolvedValue(null);
    const { default: LaunchPage } = await import("./page");

    await expect(LaunchPage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.getWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("sends a platform administrator to the existing admin destination", async () => {
    mocks.getPagePrincipal.mockResolvedValue({
      user: { id: "profile-1", platformRole: "PLATFORM_ADMIN" },
    });
    const { default: LaunchPage } = await import("./page");

    await expect(LaunchPage()).rejects.toThrow("REDIRECT:/admin/billing");
    expect(mocks.getWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("keeps an unfinished merchant in the existing setup flow", async () => {
    mocks.getPendingMerchantSetupPath.mockResolvedValue("/merchant/setup/demo-stall");
    const { default: LaunchPage } = await import("./page");

    await expect(LaunchPage()).rejects.toThrow("REDIRECT:/merchant/setup/demo-stall");
  });

  it("uses the existing role-aware workspace destination", async () => {
    const { default: LaunchPage } = await import("./page");

    await expect(LaunchPage()).rejects.toThrow("REDIRECT:/staff/demo-stall");
    expect(mocks.getDefaultWorkspacePath).toHaveBeenCalledWith([{ id: "organization-1" }]);
  });
});
