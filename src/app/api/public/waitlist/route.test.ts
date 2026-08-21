import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRequestId: vi.fn(() => "request-1"),
  hashClientIp: vi.fn(() => "a".repeat(64)),
  isTrustedOrigin: vi.fn(() => true),
  joinDigitalWaitlist: vi.fn(),
}));

vi.mock("@/lib/security", () => ({
  createRequestId: mocks.createRequestId,
  hashClientIp: mocks.hashClientIp,
  isTrustedOrigin: mocks.isTrustedOrigin,
}));
vi.mock("@/server/waitlist/digital-waitlist-service", () => ({
  joinDigitalWaitlist: mocks.joinDigitalWaitlist,
}));

import { POST } from "@/app/api/public/waitlist/route";

function request(body: unknown) {
  return new Request("http://localhost:3000/api/public/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/public/waitlist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an untrusted origin before invoking the service", async () => {
    mocks.isTrustedOrigin.mockReturnValueOnce(false);

    const response = await POST(request({}));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(mocks.joinDigitalWaitlist).not.toHaveBeenCalled();
  });

  it("returns a no-store public credential from the trusted service", async () => {
    mocks.joinDigitalWaitlist.mockResolvedValueOnce({
      publicToken: "raw-public-token",
      entryId: "33333333-3333-4333-8333-333333333333",
      status: "WAITING",
      position: 1,
      joinedAt: "2026-08-13T01:00:00.000Z",
    });

    const response = await POST(request({
      stallId: "22222222-2222-4222-8222-222222222222",
      partySize: 2,
      displayName: "測試候位",
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    await expect(response.json()).resolves.toMatchObject({
      publicToken: "raw-public-token",
      status: "WAITING",
    });
    expect(mocks.joinDigitalWaitlist).toHaveBeenCalledWith(expect.objectContaining({
      ipHash: "a".repeat(64),
      requestId: "request-1",
    }));
  });
});
