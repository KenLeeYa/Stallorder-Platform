import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/server/resilience/feature-flag-service", () => ({ resolveResilienceFeatureFlags: mocks.resolve }));
import { resolveOAuthLoginFeatureState } from "./feature-flags";

describe("password method flag resolution", () => {
  beforeEach(() => vi.clearAllMocks());
  it("resolves password disablement without turning off legacy Google or enabling migration", async () => {
    mocks.resolve.mockImplementation(async (codes: string[]) => Object.fromEntries(codes.map((code) => [code, {
      enabled: ["OAUTH_IDENTITY_FOUNDATION_ENABLED", "OAUTH_GOOGLE_ENABLED"].includes(code),
    }])));
    expect(await resolveOAuthLoginFeatureState()).toMatchObject({
      passwordEnabled: false, oauthOnly: false, foundation: true, providers: { GOOGLE: true },
    });
  });
  it("fails closed instead of reopening passwords after a flag database read failure", async () => {
    mocks.resolve.mockRejectedValue(new Error("database unavailable"));
    expect(await resolveOAuthLoginFeatureState()).toMatchObject({ passwordEnabled: false, foundation: false });
  });
});
