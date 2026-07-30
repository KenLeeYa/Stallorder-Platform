import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { replicatedPublicTables } from "./lib/dr-replication-scope.mjs";

const dr = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
});

try {
  const excluded = new Set(["backend_failover_events"]);
  const includedTables = replicatedPublicTables.filter((table) => !excluded.has(table));
  const rows = await dr.$queryRawUnsafe(
    `select
       relname,
       n_tup_ins::text,
       n_tup_upd::text,
       n_tup_del::text
     from pg_catalog.pg_stat_user_tables
     where schemaname = 'public'
     order by relname`,
  );
  const metrics = rows
    .filter((row) => includedTables.includes(row.relname))
    .map((row) => ({
      table: row.relname,
      inserts: row.n_tup_ins,
      updates: row.n_tup_upd,
      deletes: row.n_tup_del,
    }));
  const digest = createHash("sha256")
    .update(JSON.stringify(metrics))
    .digest("hex");
  const totals = metrics.reduce(
    (sum, row) => ({
      inserts: sum.inserts + BigInt(row.inserts),
      updates: sum.updates + BigInt(row.updates),
      deletes: sum.deletes + BigInt(row.deletes),
    }),
    { inserts: 0n, updates: 0n, deletes: 0n },
  );
  console.log(JSON.stringify({
    event: "dr_business_fingerprint_captured",
    digest,
    tableCount: metrics.length,
    totals: {
      inserts: totals.inserts.toString(),
      updates: totals.updates.toString(),
      deletes: totals.deletes.toString(),
    },
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_business_fingerprint_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await dr.$disconnect();
}

function requiredPostgresUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}
