import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  checkRateLimit: vi.fn(),
  settingsFindUnique: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ compare: mocks.compare }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/prisma", () => ({
  prisma: { stallOrderingSettings: { findUnique: mocks.settingsFindUnique } },
}));

import {
  ManagerAuthorizationError,
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
    mocks.settingsFindUnique.mockResolvedValue({ managerAuthorizationCodeHash: "hash" });
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

    mocks.settingsFindUnique.mockResolvedValueOnce({ managerAuthorizationCodeHash: null });
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "2468" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "CODE_NOT_CONFIGURED" }),
    );
  });

  it("rate-limits guesses and rejects a wrong code", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "2468" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "RATE_LIMITED" }),
    );

    mocks.compare.mockResolvedValueOnce(false);
    await expect(verifyManagerAuthorization({ ...input, authorizationCode: "2468" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagerAuthorizationError>>({ code: "INVALID_CODE" }),
    );
  });

  it("accepts a valid 4–8 digit code and records the staff actor", async () => {
    await expect(verifyManagerAuthorization({
      ...input,
      authorizationCode: " 2468 ",
    })).resolves.toEqual({ method: "SHARED_CODE", approvedById: input.actorProfileId });
    expect(mocks.compare).toHaveBeenCalledWith("2468", "hash");
  });
});
