import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    replicationHealthSnapshot: { findFirst: vi.fn() },
  },
}));
vi.mock("@/server/resilience/availability-config-service", () => ({ getAvailabilityConfig: vi.fn() }));
vi.mock("@/server/resilience/database-targets", () => ({
  getDrPrismaClient: vi.fn(() => null),
  isDrDatabaseConfigured: vi.fn(() => false),
}));

describe("database health probe single-flight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it("keeps sharing a timed-out raw query until that query actually settles", async () => {
    let resolveRaw!: (value: unknown) => void;
    const raw = new Promise((resolve) => { resolveRaw = resolve; });
    mocks.queryRaw.mockReturnValueOnce(raw).mockResolvedValueOnce([{ result: 1 }]);
    const { checkPrimaryDatabaseHealth } = await import("./health-service");

    const first = checkPrimaryDatabaseHealth();
    await vi.advanceTimersByTimeAsync(2_501);
    await expect(first).resolves.toMatchObject({ status: "UNAVAILABLE", reasonCode: "PROBE_TIMEOUT" });

    const second = checkPrimaryDatabaseHealth();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    resolveRaw([{ result: 1 }]);
    await expect(second).resolves.toMatchObject({ status: "HEALTHY" });
    await Promise.resolve();

    await expect(checkPrimaryDatabaseHealth()).resolves.toMatchObject({ status: "HEALTHY" });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });
});
