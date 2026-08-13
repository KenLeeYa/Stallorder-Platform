import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260813133000_global_unique_stall_code.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("global public storefront identifier migration", () => {
  it("fails closed before creating the index when lower-case codes collide", () => {
    expect(migrationSource).toContain("group by lower(stall.code)");
    expect(migrationSource).toContain("having count(*) > 1");
    expect(migrationSource).toContain("raise exception 'PUBLIC_STALL_CODE_COLLISION: %', collision_code");
    expect(migrationSource).toContain("using errcode = '23505'");
    expect(migrationSource.indexOf("PUBLIC_STALL_CODE_COLLISION")).toBeLessThan(
      migrationSource.indexOf("create unique index"),
    );
  });

  it("creates one idempotent global unique index on lower(code)", () => {
    expect(migrationSource).toContain([
      "create unique index if not exists stalls_code_lower_unique_idx",
      "on public.stalls ((lower(code)));",
    ].join("\n"));
  });

  it("does not rewrite legacy slugs or stall data", () => {
    expect(migrationSource).not.toMatch(/\bupdate\s+public\.stalls\b/i);
    expect(migrationSource).not.toMatch(/\bdelete\s+from\s+public\.stalls\b/i);
    expect(migrationSource).not.toMatch(/\bslug\b/i);
  });
});
