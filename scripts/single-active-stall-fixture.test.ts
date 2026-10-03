import { afterEach, expect, test, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prepareSingleActiveStallFixture } from "../e2e/single-active-stall-fixture";

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv("CI", "true");
  vi.stubEnv("DATABASE_URL", "postgresql://localhost:54322/postgres");
  const rows = [
    { id: "22222222-2222-4222-8222-222222222222", slug: "aming-chicken", name: "阿明鹽酥雞", isActive: true, updatedAt: new Date(0) },
    { id: "synthetic", slug: "cash-shift-e2e-aabbccdd", name: "現金交班 QA", isActive: true, updatedAt: new Date(0) },
  ];
  const updateMany = vi.fn(async (args: Prisma.StallUpdateManyArgs) => { void args; return { count: 1 }; });
  const prisma = { stall: { findMany: vi.fn(async () => rows), updateMany } } as unknown as PrismaClient;
  return { rows, updateMany, prisma };
}
test("snapshots only owned active synthetic stalls and restores with exact CAS", async () => {
  const f = fixture(); const restore = await prepareSingleActiveStallFixture(f.prisma);
  expect(f.updateMany).toHaveBeenCalledWith({ where: { id: "synthetic", organizationId: "11111111-1111-4111-8111-111111111111", slug: "cash-shift-e2e-aabbccdd", isActive: true, updatedAt: new Date(0) }, data: { isActive: false, updatedAt: expect.any(Date) } });
  await restore(); expect(f.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: "synthetic", isActive: false }, data: { isActive: true } });
});
test("rejects remote DB without queries", async () => {
  const f = fixture(); vi.stubEnv("DATABASE_URL", "postgresql://remote.example:54322/postgres");
  await expect(prepareSingleActiveStallFixture(f.prisma)).rejects.toThrow("LOCAL_TARGET"); expect(f.updateMany).not.toHaveBeenCalled();
});
test("rejects unknown extra before changes", async () => {
  const f = fixture(); f.rows[1].name = "Real merchant";
  await expect(prepareSingleActiveStallFixture(f.prisma)).rejects.toThrow("UNKNOWN_EXTRA"); expect(f.updateMany).not.toHaveBeenCalled();
});
test("rejects seed drift", async () => {
  const f = fixture(); f.rows[0].isActive = false;
  await expect(prepareSingleActiveStallFixture(f.prisma)).rejects.toThrow("SEED_REQUIRED");
});
test("restore fails closed on concurrent drift", async () => {
  const f = fixture(); const restore = await prepareSingleActiveStallFixture(f.prisma); f.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(restore()).rejects.toThrow("RESTORE_DRIFT");
});
test("restore attempts remaining independent rows after the first CAS drift", async () => {
  const f = fixture();
  f.rows.push({ id: "second", slug: "e2e-night-market-two-aabbccdd", name: "E2E 夜市二號攤", isActive: true, updatedAt: new Date(0) });
  const restore = await prepareSingleActiveStallFixture(f.prisma);
  f.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(restore()).rejects.toThrow("RESTORE_DRIFT");
  expect(f.updateMany).toHaveBeenCalledTimes(4);
  expect(f.updateMany.mock.calls[3][0]).toMatchObject({ where: { id: "second", isActive: false, updatedAt: expect.any(Date) }, data: { isActive: true, updatedAt: new Date(0) } });
});
