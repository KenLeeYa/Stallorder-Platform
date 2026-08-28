import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  checkRateLimit: vi.fn(),
  releaseRateLimitToken: vi.fn(),
  logEvent: vi.fn(),
  settingsFindUnique: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ compare: mocks.compare }));
vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  releaseRateLimitToken: mocks.releaseRateLimitToken,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { stallOrderingSettings: { findUnique: mocks.settingsFindUnique } },
}));

import {
  ManagerAuthorizationError,
  newManagerAuthorizationCodeSchema,
  verifyManagerAuthorization,
} from "./manager-authorization";

const input = {
  stallId: "11111111-1111-4111-8111-111111111111",
  actorProfileId: "22222222-2222-4222-8222-222222222222",
  actorRoles: ["STAFF"] as const,
  operation: "CANCEL_COMPLETED_ORDER" as const,
};

describe("shared manager authorization code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.releaseRateLimitToken.mockResolvedValue(undefined);
    mocks.settingsFindUnique.mockResolvedValue({
      managerAuthorizationCodeHash: "hash",
      managerAuthorizationCodeUpdatedAt: new Date("2026-08-28T00:00:00.000Z"),
    });
    mocks.compare.mockResolvedValue(true);
  });

  it("lets a manager role approve without exposing or checking the shared code", async () => {
    await expect(verifyManagerAuthorization({
      ...input,
      actorRoles: ["STALL_MANAGER"],
    })).resolves.toEqual({ method: "ROLE", approvedById: input.actorProfileId });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.settingsFindUnique).not.toHaveBeenCalled();
  });

  it("requires a configured code for staff-sensitive operations", async () => {
    await expect(verifyManagerAuthorization(input)).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "CODE_REQUIRED" }),
    );

    mocks.settingsFindUnique.mockResolvedValueOnce({
      managerAuthorizationCodeHash: null,
      managerAuthorizationCodeUpdatedAt: null,
    });
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "246810" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "CODE_NOT_CONFIGURED" }),
    );
  });

  it("rate-limits guesses and rejects a wrong code", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "246810" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "RATE_LIMITED" }),
    );

    mocks.compare.mockResolvedValueOnce(false);
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "246810" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "INVALID_CODE" }),
    );
  });

  it("rejects four-digit codes and shares one stall/code-version budget for valid guesses", async () => {
    await expect(verifyManagerAuthorization({
      ...input,
      authorizationCode: "2468",
    })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "INVALID_CODE" }),
    );

    await expect(verifyManagerAuthorization({
      ...input,
      authorizationCode: " 246810 ",
    })).resolves.toEqual({ method: "SHARED_CODE", approvedById: input.actorProfileId });
    expect(mocks.compare).toHaveBeenCalledWith("246810", "hash");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith({
      scope: "manager-authorization-code",
      identifier: `${input.stallId}:${new Date("2026-08-28T00:00:00.000Z").getTime()}`,
      limit: 8,
      windowMs: 15 * 60_000,
    });
    expect(mocks.releaseRateLimitToken).toHaveBeenCalledWith({
      scope: "manager-authorization-code",
      identifier: `${input.stallId}:${new Date("2026-08-28T00:00:00.000Z").getTime()}`,
    });
  });

  it("keeps failed guesses in the shared budget and refunds successful approvals", async () => {
    mocks.compare.mockResolvedValueOnce(false);
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "246810" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "INVALID_CODE" }),
    );
    expect(mocks.releaseRateLimitToken).not.toHaveBeenCalled();

    mocks.compare.mockResolvedValueOnce(true);
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "246810" })).resolves.toEqual({
      method: "SHARED_CODE",
      approvedById: input.actorProfileId,
    });
    expect(mocks.releaseRateLimitToken).toHaveBeenCalledTimes(1);
  });

  it("requires newly configured codes to contain at least six digits", () => {
    expect(newManagerAuthorizationCodeSchema.safeParse("2468").success).toBe(false);
    expect(newManagerAuthorizationCodeSchema.safeParse("246810").success).toBe(true);
  });
});
