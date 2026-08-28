import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

describe("public rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops at the stable source budget before creating an attacker-selected resource bucket", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.queryRaw.mockResolvedValueOnce([{ count: 11, expiresAt }]);
    const { checkPublicRateLimit } = await import("./rate-limit");

    await expect(checkPublicRateLimit({
      scope: "public-test",
      sourceIdentifier: "stable-source",
      resourceIdentifier: "rotating-resource-id",
      sourceLimit: 10,
      resourceLimit: 5,
      windowMs: 60_000,
    })).resolves.toMatchObject({ allowed: false, remaining: 0 });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const sql = (mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(" ");
    expect(sql).toContain("delete from public.rate_limit_buckets");
    expect(sql).toContain("limit 100");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("bucket_count <");
  });

  it("checks the resource budget only after the stable source is accepted", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.queryRaw
      .mockResolvedValueOnce([{ count: 1, expiresAt }])
      .mockResolvedValueOnce([{ count: 6, expiresAt }]);
    const { checkPublicRateLimit } = await import("./rate-limit");

    await expect(checkPublicRateLimit({
      scope: "public-test",
      sourceIdentifier: "stable-source",
      resourceIdentifier: "resource-id",
      sourceLimit: 10,
      resourceLimit: 5,
      windowMs: 60_000,
    })).resolves.toMatchObject({ allowed: false, remaining: 0 });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("fails closed without inserting when a scope reaches its hard bucket limit", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    const { checkRateLimit } = await import("./rate-limit");

    await expect(checkRateLimit({
      scope: "public-test:source",
      identifier: "new-attacker-source",
      limit: 10,
      windowMs: 60_000,
    })).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });
});
