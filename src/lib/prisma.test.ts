import { afterEach, describe, expect, it, vi } from "vitest";

describe("Prisma client initialization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not require DATABASE_URL while importing the lazy proxy", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await expect(import("./prisma")).resolves.toHaveProperty("prisma");
  });

  it("fails clearly when database access is requested without DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getPrismaClient } = await import("./prisma");

    expect(() => getPrismaClient()).toThrow("DATABASE_URL is required");
  });

  it("reuses the development client", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@example.invalid:5432/postgres");
    const { getPrismaClient } = await import("./prisma");

    expect(getPrismaClient()).toBe(getPrismaClient());
  });
});
