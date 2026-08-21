import { describe, expect, it, vi } from "vitest";
import {
  assertGlobalStallCodeAvailable,
  GlobalStallCodeConflictError,
} from "./global-stall-code-guard";

describe("global stall code application guard", () => {
  it("takes the normalized advisory lock before checking for a collision", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue(null);

    await expect(assertGlobalStallCodeAvailable({
      $queryRaw: queryRaw,
      stall: { findFirst } as never,
    }, " Shared-Code ")).resolves.toBeUndefined();

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { code: { equals: "shared-code", mode: "insensitive" } },
      select: { id: true },
    });
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findFirst.mock.invocationCallOrder[0],
    );
  });

  it("fails closed when another organization already owns the code", async () => {
    const database = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      stall: { findFirst: vi.fn().mockResolvedValue({ id: "stall-1" }) },
    };

    await expect(assertGlobalStallCodeAvailable(
      database as never,
      "SHARED-CODE",
    )).rejects.toBeInstanceOf(GlobalStallCodeConflictError);
  });
});
