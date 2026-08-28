import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), acquireLease: vi.fn(), findEvent: vi.fn() }));

vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/prisma", () => ({ prisma: { orderEvent: { findFirst: mocks.findEvent } } }));
vi.mock("@/server/realtime/sse-admission", () => ({ acquireStaffSseLease: mocks.acquireLease }));

describe("kitchen SSE admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      ok: true,
      requestId: "request-1",
      principal: { user: { id: "profile-1" } },
      stall: { id: "stall-1" },
    });
  });

  it("returns 429 without polling when the stream lease is full", async () => {
    mocks.acquireLease.mockResolvedValue({ allowed: false, retryAfterSeconds: 20, release: vi.fn() });
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/stalls/demo/kitchen/stream"), {
      params: Promise.resolve({ stallSlug: "demo" }),
    });
    expect(response.status).toBe(429);
    expect(mocks.acquireLease).toHaveBeenCalledWith({
      profileId: "profile-1", stallId: "stall-1", streamKind: "kitchen",
    });
    expect(mocks.findEvent).not.toHaveBeenCalled();
  });
});
