import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestPrincipal: vi.fn(),
  revokeAllProfileSessions: vi.fn(),
  validateCsrf: vi.fn(),
  checkRateLimit: vi.fn(),
  recordAuditEvent: vi.fn(),
  createRequestId: vi.fn(() => "request-1"),
  hashClientIp: vi.fn(() => "hashed-ip"),
  profileFindUnique: vi.fn(),
  organizationMembershipCount: vi.fn(),
  stallMembershipCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getRequestPrincipal: mocks.getRequestPrincipal,
  revokeAllProfileSessions: mocks.revokeAllProfileSessions,
}));

vi.mock("@/lib/csrf", () => ({
  validateCsrf: mocks.validateCsrf,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: mocks.recordAuditEvent,
}));

vi.mock("@/lib/security", () => ({
  createRequestId: mocks.createRequestId,
  hashClientIp: mocks.hashClientIp,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: {
      findUnique: mocks.profileFindUnique,
    },
    organizationMembership: {
      count: mocks.organizationMembershipCount,
    },
    stallMembership: {
      count: mocks.stallMembershipCount,
    },
  },
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const orgAdminId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";

function buildRequest(body: unknown, userId = ownerId) {
  return {
    request: new Request(`https://app.qidaigo.com/api/admin/users/${userId}/sessions/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.qidaigo.com",
      },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ userId }),
  };
}

describe("POST /api/admin/users/[userId]/sessions/revoke", () => {
  beforeEach(() => {
    mocks.getRequestPrincipal.mockResolvedValue({
      sessionId: "session-1",
      user: {
        id: orgAdminId,
        platformRole: null,
      },
    });
    mocks.validateCsrf.mockReturnValue(true);
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    mocks.profileFindUnique.mockResolvedValue({ id: ownerId });
    mocks.organizationMembershipCount.mockImplementation(async ({ where }: { where: { profileId: string } }) => {
      if (where.profileId === orgAdminId) return 1;
      if (where.profileId === ownerId) return 1;
      return 0;
    });
    mocks.stallMembershipCount.mockResolvedValue(0);
    mocks.revokeAllProfileSessions.mockResolvedValue({ count: 4 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lets an organization admin revoke sessions for a same-org owner target", async () => {
    const route = await import("./route");

    const response = await route.POST(
      buildRequest({ organizationId, reason: "Owner session reset for testing" }).request,
      { params: buildRequest({ organizationId, reason: "Owner session reset for testing" }).params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, revokedSessions: 4 });
    expect(mocks.revokeAllProfileSessions).toHaveBeenCalledWith(ownerId, "ADMIN_REVOKED");
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "SESSION_REVOKED",
      actorProfileId: orgAdminId,
      entityId: ownerId,
      organizationId,
      outcome: "SUCCESS",
    }));
  });

  it("denies the action when the target has no membership in the supplied organization", async () => {
    mocks.organizationMembershipCount.mockImplementation(async ({ where }: { where: { profileId: string } }) => {
      if (where.profileId === orgAdminId) return 1;
      return 0;
    });

    const route = await import("./route");
    const response = await route.POST(
      buildRequest({ organizationId, reason: "Cross-org attempt" }).request,
      { params: buildRequest({ organizationId, reason: "Cross-org attempt" }).params },
    );

    expect(response.status).toBe(404);
    expect(mocks.revokeAllProfileSessions).not.toHaveBeenCalled();
  });
});
