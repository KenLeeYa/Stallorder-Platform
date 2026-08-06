import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  DiningFloorNotFoundError,
  materializeDefaultDiningFloor,
  materializeDefaultDiningFloorForFloorCreation,
  resolveDiningFloorIdForWrite,
} from "./dining-floor-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const floorId = "33333333-3333-4333-8333-333333333333";

function transaction() {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as unknown as Prisma.TransactionClient;
}

describe("dining floor write resolution", () => {
  it("accepts only an explicitly scoped floor", async () => {
    const tx = transaction();
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([{ id: floorId }]);

    await expect(resolveDiningFloorIdForWrite(tx, { organizationId, stallId, floorId }))
      .resolves.toBe(floorId);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("rejects an explicit floor outside the tenant stall", async () => {
    const tx = transaction();
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([]);

    await expect(resolveDiningFloorIdForWrite(tx, { organizationId, stallId, floorId }))
      .rejects.toBeInstanceOf(DiningFloorNotFoundError);
  });

  it("materializes 1樓 and assigns legacy tables through the supplied transaction", async () => {
    const tx = transaction();
    vi.mocked(tx.$queryRaw)
      .mockResolvedValueOnce([{ id: stallId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: floorId,
        organizationId,
        stallId,
        name: "1樓",
        sortOrder: 1,
      }]);

    await expect(materializeDefaultDiningFloor(tx, { organizationId, stallId }))
      .resolves.toBe(floorId);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("reuses a materialized floor while still assigning null legacy tables", async () => {
    const tx = transaction();
    vi.mocked(tx.$queryRaw)
      .mockResolvedValueOnce([{ id: stallId }])
      .mockResolvedValueOnce([{
        id: floorId,
        organizationId,
        stallId,
        name: "1樓",
        sortOrder: 1,
      }]);

    await expect(resolveDiningFloorIdForWrite(tx, { organizationId, stallId, floorId: null }))
      .resolves.toBe(floorId);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not recreate 1樓 when an existing renamed floor owns all tables", async () => {
    const tx = transaction();
    vi.mocked(tx.$queryRaw)
      .mockResolvedValueOnce([{ id: stallId }])
      .mockResolvedValueOnce([{ hasFloors: true, hasLegacyTables: false }]);

    await expect(materializeDefaultDiningFloorForFloorCreation(tx, { organizationId, stallId }))
      .resolves.toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    { hasFloors: true, hasLegacyTables: true, reason: "legacy tables remain" },
    { hasFloors: false, hasLegacyTables: false, reason: "no physical floor exists" },
  ])("materializes 1樓 before floor creation when $reason", async ({ hasFloors, hasLegacyTables }) => {
    const tx = transaction();
    vi.mocked(tx.$queryRaw)
      .mockResolvedValueOnce([{ id: stallId }])
      .mockResolvedValueOnce([{ hasFloors, hasLegacyTables }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: floorId,
        organizationId,
        stallId,
        name: "1樓",
        sortOrder: 1,
      }]);

    await expect(materializeDefaultDiningFloorForFloorCreation(tx, { organizationId, stallId }))
      .resolves.toBe(floorId);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
