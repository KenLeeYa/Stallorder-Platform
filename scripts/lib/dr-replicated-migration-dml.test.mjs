import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replicatedPublicTables } from "./dr-replication-scope.mjs";

const grandfatheredMigration = "20260830010000_multitenant_einvoice_local_mock.sql";
const grandfatheredDigest = "42bedfb914ec6a3743dc123bcdd12c8439f62531f091de46f520c08554165787";

describe("DR-first replicated table migration fencing", () => {
  it("pins the final reviewed replicated-data migration exception", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations", grandfatheredMigration),
      "utf8",
    ).replaceAll("\r\n", "\n");
    expect(createHash("sha256").update(migration).digest("hex")).toBe(
      grandfatheredDigest,
    );
  });

  it("forbids future migrations from mutating replicated table data", () => {
    const migrationsDirectory = join(process.cwd(), "supabase/migrations");
    const futureMigrations = readdirSync(migrationsDirectory)
      .filter((name) => /^\d+_.+\.sql$/u.test(name))
      .filter((name) => name > grandfatheredMigration);

    for (const name of futureMigrations) {
      const migration = readFileSync(join(migrationsDirectory, name), "utf8");
      for (const table of replicatedPublicTables) {
        expect(migration, `${name} mutates replicated table ${table}`).not.toMatch(
          new RegExp(
            `(?:insert\\s+into|update|delete\\s+from|truncate(?:\\s+table)?)\\s+public\\.${table}\\b`,
            "iu",
          ),
        );
      }
    }
  });
});
