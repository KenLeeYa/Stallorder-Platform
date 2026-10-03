import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPublicationTableExpression,
  environmentLocalTables,
  replicatedPublicTables,
} from "./dr-replication-scope.mjs";

const migrations = new URL("../../supabase/migrations/", import.meta.url);
const governanceMigrations = new Set([
  "20260913140000_security_privacy_governance.sql",
  "20260913150000_privacy_execution_evidence.sql",
]);
const createdTables = (sql) => [...sql.matchAll(
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)(?:"([a-z0-9_]+)"|([a-z0-9_]+))/gi,
)].map((match) => match[1] ?? match[2]);

describe("integrated release DR table classification", () => {
  it("classifies every public table created by integrated and future migrations", () => {
    const files = readdirSync(migrations).filter((file) =>
      /^\d{14}_.+\.sql$/.test(file)
      && (file.slice(0, 14) >= "20260925000000" || governanceMigrations.has(file)));
    const created = files.flatMap((file) => createdTables(readFileSync(new URL(file, migrations), "utf8"))
      .map((table) => ({ file, table })));
    expect(created.length).toBeGreaterThan(20);
    expect(created.filter(({ table }) =>
      Number(replicatedPublicTables.includes(table)) + Number(environmentLocalTables.includes(table)) !== 1,
    )).toEqual([]);
    expect(new Set(environmentLocalTables).size).toBe(environmentLocalTables.length);
    expect(environmentLocalTables.filter((table) => replicatedPublicTables.includes(table))).toEqual([]);
  });

  it("publishes durable member, handoff and notification state without losing ciphertext or revocations", () => {
    const durable = [
      "line_platform_members", "line_platform_stalls", "line_platform_order_owners",
      "line_platform_member_audit", "line_platform_friendships", "line_platform_pickup_credentials",
      "notification_read_receipts", "notification_preferences", "product_feedback",
    ];
    for (const table of durable) {
      expect(replicatedPublicTables.filter((entry) => entry === table)).toEqual([table]);
      expect(buildPublicationTableExpression(table)).toBe(`"public"."${table}"`);
    }
  });

  it("refuses sandbox payment and environment-local step-up publication", () => {
    for (const table of ["security_step_up_grants", "line_platform_payment_attempts", "line_platform_payment_operations"]) {
      expect(environmentLocalTables).toContain(table);
      expect(() => buildPublicationTableExpression(table)).toThrow("REPLICATION_TABLE_NOT_ALLOWED");
    }
    const paymentMigration = readFileSync(new URL("20260927040000_line_platform_payment_operations.sql", migrations), "utf8");
    expect(paymentMigration).toContain("environment in ('local','preview')");
    const paymentRuntime = readFileSync(new URL("../../src/server/payment-providers/line-platform-payment-config.ts", import.meta.url), "utf8");
    expect(paymentRuntime).toContain('env.VERCEL_ENV === "production"');
    expect(paymentRuntime).toContain('"LINE_PAY_SANDBOX_ONLY"');
    const platformRuntime = readFileSync(new URL("../../src/server/line-platform/runtime.ts", import.meta.url), "utf8");
    expect(platformRuntime).toContain("target.data.fingerprint !== platformDatabaseFingerprint(env.DATABASE_URL)");
  });

  it("recognizes a newly introduced table instead of silently omitting it", () => {
    const future = createdTables('CREATE TABLE IF NOT EXISTS public."future_order_evidence" (id uuid primary key);');
    expect(future).toEqual(["future_order_evidence"]);
    expect(future.filter((table) => !replicatedPublicTables.includes(table) && !environmentLocalTables.includes(table)))
      .toEqual(["future_order_evidence"]);
  });
});
