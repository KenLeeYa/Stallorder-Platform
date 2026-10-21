import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateResilienceFeatureFlag, resilienceFeatureFlagDefaults, resolveResilienceFeatureFlags } from "./feature-flag-service";
import { getStaffWorkspaceRedesignEnabled } from "./staff-workspace-rollout";
import { logEvent } from "@/lib/audit";

vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("./feature-flag-service", async (original) => ({
  ...await original<typeof import("./feature-flag-service")>(), resolveResilienceFeatureFlags: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("staff presentation rollout", () => {
  it("defaults off and cannot leak a stall override to another stall or organization", () => {
    const code = "STAFF_WORKSPACE_REDESIGN_ENABLED";
    expect(resilienceFeatureFlagDefaults[code]).toBe(false);
    const flag = { code, defaultEnabled: false, overrides: [{ id: "override", scopeType: "STALL", organizationId: "org-a", stallId: "stall-a", deviceId: null, enabled: true, rolloutPercentage: null, expiresAt: null }] };
    expect(evaluateResilienceFeatureFlag(flag, { organizationId: "org-a", stallId: "stall-a" }).enabled).toBe(true);
    expect(evaluateResilienceFeatureFlag(flag, { organizationId: "org-a", stallId: "stall-b" }).enabled).toBe(false);
    expect(evaluateResilienceFeatureFlag(flag, { organizationId: "org-b", stallId: "stall-a" }).enabled).toBe(false);
  });

  it("passes only the authorized page's scope to the existing resolver", async () => {
    vi.mocked(resolveResilienceFeatureFlags).mockResolvedValue({ STAFF_WORKSPACE_REDESIGN_ENABLED: { enabled: true } } as Awaited<ReturnType<typeof resolveResilienceFeatureFlags>>);
    expect(await getStaffWorkspaceRedesignEnabled("org-a", "stall-a")).toBe(true);
    expect(resolveResilienceFeatureFlags).toHaveBeenCalledWith(["STAFF_WORKSPACE_REDESIGN_ENABLED"], { organizationId: "org-a", stallId: "stall-a" });
  });

  it("keeps the legacy workflow available when optional configuration cannot be read", async () => {
    vi.mocked(resolveResilienceFeatureFlags).mockRejectedValue(new Error("private connection details"));
    expect(await getStaffWorkspaceRedesignEnabled("org-a", "stall-a")).toBe(false);
    expect(logEvent).toHaveBeenCalledExactlyOnceWith("warn", "STAFF_WORKSPACE_FLAG_FALLBACK", { fallback: "legacy" });
  });
});
