import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acquire: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ acquireRateLimitLease: mocks.acquire }));

describe("staff SSE admission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stops before the stall lease when the profile cap is full", async () => {
    mocks.acquire.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30, release: vi.fn() });
    const { acquireStaffSseLease } = await import("./sse-admission");
    const lease = await acquireStaffSseLease({ profileId: "profile", stallId: "stall", streamKind: "orders" });
    expect(lease.allowed).toBe(false);
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
  });

  it("releases the profile lease when the stall cap is full", async () => {
    const releaseProfile = vi.fn();
    mocks.acquire
      .mockResolvedValueOnce({ allowed: true, remaining: 1, retryAfterSeconds: 30, release: releaseProfile })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30, release: vi.fn() });
    const { acquireStaffSseLease } = await import("./sse-admission");
    const lease = await acquireStaffSseLease({ profileId: "profile", stallId: "stall", streamKind: "kitchen" });
    expect(lease.allowed).toBe(false);
    expect(releaseProfile).toHaveBeenCalledTimes(1);
  });

  it("releases both successful leases only once", async () => {
    const releaseProfile = vi.fn();
    const releaseStall = vi.fn();
    mocks.acquire
      .mockResolvedValueOnce({ allowed: true, remaining: 1, retryAfterSeconds: 30, release: releaseProfile })
      .mockResolvedValueOnce({ allowed: true, remaining: 20, retryAfterSeconds: 30, release: releaseStall });
    const { acquireStaffSseLease } = await import("./sse-admission");
    const lease = await acquireStaffSseLease({ profileId: "profile", stallId: "stall", streamKind: "orders" });
    await lease.release();
    await lease.release();
    expect(releaseProfile).toHaveBeenCalledTimes(1);
    expect(releaseStall).toHaveBeenCalledTimes(1);
  });
});
