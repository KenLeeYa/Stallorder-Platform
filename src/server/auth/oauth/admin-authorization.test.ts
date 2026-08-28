import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profileFindUnique: vi.fn(),
  organizationMembershipCount: vi.fn(),
  organizationMembershipFindFirst: vi.fn(),
  stallMembershipCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findUnique: mocks.profileFindUnique },
    organizationMembership: {
      count: mocks.organizationMembershipCount,
      findFirst: mocks.organizationMembershipFindFirst,
    },
    stallMembership: { count: mocks.stallMembershipCount },
  },
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333";

function principal(role: "PLATFORM_ADMIN" | null = null) {
  return {
    sessionId: "44444444-4444-4444-8444-444444444444",
    sessionExpiresAt: new Date(Date.now() + 60_000),
    csrfTokenHash: "csrf",
    user: {
      id: actorId,
      authUserId: null,
      email: "actor@example.test",
      displayName: "Actor",
      platformRole: role,
    },
  };
}

describe("assertIdentityInvitationAdminScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileFindUnique
      .mockResolvedValueOnce({ id: targetId })
      .mockResolvedValueOnce({
        platformRole: null,
        organizationMemberships: [],
      });
    mocks.organizationMembershipCount.mockImplementation(async ({ where }) => (
      where.profileId === actorId || where.profileId === targetId ? 1 : 0
    ));
    mocks.stallMembershipCount.mockResolvedValue(0);
    mocks.organizationMembershipFindFirst.mockResolvedValue({ role: "ORGANIZATION_ADMIN" });
  });

  it("denies an organization admin from issuing an identity link for an owner", async () => {
    mocks.profileFindUnique.mockReset()
      .mockResolvedValueOnce({ id: targetId })
      .mockResolvedValueOnce({
        platformRole: null,
        organizationMemberships: [{ role: "ORGANIZATION_OWNER" }],
      });
    const { assertIdentityInvitationAdminScope } = await import("./admin-authorization");

    await expect(assertIdentityInvitationAdminScope({
      principal: principal(),
      targetProfileId: targetId,
      organizationId,
    })).rejects.toThrow("IDENTITY_ADMIN_SCOPE_DENIED");
  });

  it("denies an organization admin from issuing an identity link for a peer admin", async () => {
    mocks.profileFindUnique.mockReset()
      .mockResolvedValueOnce({ id: targetId })
      .mockResolvedValueOnce({
        platformRole: null,
        organizationMemberships: [{ role: "ORGANIZATION_ADMIN" }],
      });
    const { assertIdentityInvitationAdminScope } = await import("./admin-authorization");

    await expect(assertIdentityInvitationAdminScope({
      principal: principal(),
      targetProfileId: targetId,
      organizationId,
    })).rejects.toThrow("IDENTITY_ADMIN_SCOPE_DENIED");
  });

  it("allows an organization owner to issue a link for a lower role", async () => {
    mocks.organizationMembershipFindFirst.mockResolvedValue({ role: "ORGANIZATION_OWNER" });
    mocks.profileFindUnique.mockReset()
      .mockResolvedValueOnce({ id: targetId })
      .mockResolvedValueOnce({
        platformRole: null,
        organizationMemberships: [{ role: "ORGANIZATION_ADMIN" }],
      });
    const { assertIdentityInvitationAdminScope } = await import("./admin-authorization");

    await expect(assertIdentityInvitationAdminScope({
      principal: principal(),
      targetProfileId: targetId,
      organizationId,
    })).resolves.toEqual({ organizationId });
  });

  it("allows a platform administrator without organization membership", async () => {
    mocks.profileFindUnique.mockReset().mockResolvedValueOnce({ id: targetId });
    const { assertIdentityInvitationAdminScope } = await import("./admin-authorization");

    await expect(assertIdentityInvitationAdminScope({
      principal: principal("PLATFORM_ADMIN"),
      targetProfileId: targetId,
    })).resolves.toEqual({ organizationId: null });
  });
});
