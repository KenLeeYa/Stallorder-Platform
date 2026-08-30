import { describe, expect, it, vi } from "vitest";
import {
  DR_RESET_LOCK_RELEASE_PHASES,
  releaseDrResetLocks,
} from "./dr-reset-lock-release.mjs";

describe("DR reset lock release", () => {
  it("executes every server-quoted drop as a separately awaited statement", async () => {
    const executed = [];
    let phaseIndex = 0;
    const database = {
      $transaction: vi.fn(),
      $queryRawUnsafe: vi.fn(async () => {
        const currentPhase = DR_RESET_LOCK_RELEASE_PHASES[phaseIndex];
        phaseIndex += 1;
        return [{ statement: `${currentPhase.prefix}\"target\" cascade` }];
      }),
      $executeRawUnsafe: vi.fn(async (statement) => {
        executed.push(statement);
        return 0;
      }),
    };

    const result = await releaseDrResetLocks(database);

    expect(database.$queryRawUnsafe).toHaveBeenCalledTimes(
      DR_RESET_LOCK_RELEASE_PHASES.length,
    );
    expect(database.$executeRawUnsafe).toHaveBeenCalledTimes(
      DR_RESET_LOCK_RELEASE_PHASES.length,
    );
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(executed).toHaveLength(DR_RESET_LOCK_RELEASE_PHASES.length);
    expect(result).toEqual({
      phases: DR_RESET_LOCK_RELEASE_PHASES.length,
      statements: DR_RESET_LOCK_RELEASE_PHASES.length,
    });
  });

  it("limits catalog discovery to application schemas and public objects", () => {
    const queries = DR_RESET_LOCK_RELEASE_PHASES.map(({ query }) => query);

    expect(queries[0]).toContain(
      "pn.nspname in ('app_private', 'internal')",
    );
    expect(
      queries.slice(2).every((query) => query.includes("n.nspname = 'public'")),
    ).toBe(true);
    expect(queries.join("\n")).not.toContain("drop schema if exists auth");
    expect(queries.join("\n")).not.toContain("drop schema if exists storage");
  });

  it("fails closed before executing a malformed generated statement", async () => {
    const database = {
      $queryRawUnsafe: vi.fn(async () => [{ statement: "" }]),
      $executeRawUnsafe: vi.fn(),
    };

    await expect(releaseDrResetLocks(database)).rejects.toThrow(
      "DR_RESET_DROP_STATEMENT_INVALID",
    );
    expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
