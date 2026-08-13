import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  authSession: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { authSession: mocks.authSession },
}));

import { getPagePrincipal, getRequestPrincipal, SESSION_COOKIE } from "@/lib/auth";
import { SESSION_DEVICE_COOKIE } from "@/lib/security";
import { AUTH_SESSION_ABSOLUTE_MAX_AGE_MS } from "@/lib/session-lifetime";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE_ID = "22222222-2222-4222-8222-222222222222";

function sessionFixture() {
  const now = Date.now();
  return {
    id: "33333333-3333-4333-8333-333333333333",
    deviceId: DEVICE_ID,
    rotationFamilyId: "44444444-4444-4444-8444-444444444444",
    issuedAt: new Date(now - 24 * 60 * 60_000),
    expiresAt: new Date(now + 24 * 60 * 60_000),
    revokedAt: null,
    profileSessionVersion: 1,
    csrfTokenHash: "csrf-hash",
    profile: {
      id: "55555555-5555-4555-8555-555555555555",
      authUserId: null,
      email: "staff@example.test",
      displayName: "Staff",
      platformRole: null,
      isActive: true,
      sessionVersion: 1,
    },
  };
}

function requestWithCookies(deviceId?: string) {
  const deviceCookie = deviceId ? `; ${SESSION_DEVICE_COOKIE}=${deviceId}` : "";
  return new Request("https://app.qidaigo.com/api/auth/me", {
    headers: { cookie: `${SESSION_COOKIE}=opaque-token${deviceCookie}` },
  });
}

function pageCookieStore(deviceId?: string) {
  return {
    get(name: string) {
      if (name === SESSION_COOKIE) return { value: "opaque-token" };
      if (name === SESSION_DEVICE_COOKIE && deviceId) return { value: deviceId };
      return undefined;
    },
  };
}

describe("request principal session boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSession.findUnique.mockResolvedValue(sessionFixture());
    mocks.authSession.findFirst.mockResolvedValue({
      issuedAt: new Date(Date.now() - 24 * 60 * 60_000),
    });
    mocks.authSession.update.mockResolvedValue({});
    mocks.authSession.updateMany.mockResolvedValue({ count: 1 });
  });

  it("accepts an API session only when the installed-device cookie matches", async () => {
    const principal = await getRequestPrincipal(requestWithCookies(DEVICE_ID));

    expect(principal?.sessionId).toBe(sessionFixture().id);
    expect(mocks.authSession.update).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["wrong", OTHER_DEVICE_ID],
  ])("rejects and revokes an API session with a %s device cookie", async (_label, deviceId) => {
    await expect(getRequestPrincipal(requestWithCookies(deviceId))).resolves.toBeNull();
    expect(mocks.authSession.update).toHaveBeenCalledWith({
      where: { id: sessionFixture().id },
      data: expect.objectContaining({ revokeReason: "DEVICE_MISMATCH" }),
    });
  });

  it("applies the same device binding to page authentication", async () => {
    mocks.cookies.mockResolvedValue(pageCookieStore(DEVICE_ID));
    await expect(getPagePrincipal()).resolves.toMatchObject({ sessionId: sessionFixture().id });

    vi.clearAllMocks();
    mocks.authSession.findUnique.mockResolvedValue(sessionFixture());
    mocks.authSession.update.mockResolvedValue({});
    mocks.cookies.mockResolvedValue(pageCookieStore());
    await expect(getPagePrincipal()).resolves.toBeNull();
  });

  it("rejects a normal API request once its rotation family reaches thirty days", async () => {
    mocks.authSession.findFirst.mockResolvedValue({
      issuedAt: new Date(Date.now() - AUTH_SESSION_ABSOLUTE_MAX_AGE_MS),
    });

    await expect(getRequestPrincipal(requestWithCookies(DEVICE_ID))).resolves.toBeNull();
    expect(mocks.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        rotationFamilyId: sessionFixture().rotationFamilyId,
        revokedAt: null,
      },
      data: expect.objectContaining({ revokeReason: "ABSOLUTE_LIFETIME_REACHED" }),
    });
  });
});
