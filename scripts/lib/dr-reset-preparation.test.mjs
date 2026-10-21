import { describe, expect, it } from "vitest";
import { retiredDrSequenceCleanupSql } from "./dr-reset-preparation.mjs";

describe("retired DR reset preparation", () => {
  it("targets only ordinary public sequences, including unowned invoice counters", () => {
    expect(retiredDrSequenceCleanupSql).toContain("c.relkind = 'S'");
    expect(retiredDrSequenceCleanupSql).toContain("n.nspname = 'public'");
    expect(retiredDrSequenceCleanupSql).toContain("d.deptype = 'e'");
    expect(retiredDrSequenceCleanupSql).toContain("format('drop sequence %I.%I cascade'");
    expect(retiredDrSequenceCleanupSql).not.toMatch(/drop schema|drop database|alter role/i);
  });
});
