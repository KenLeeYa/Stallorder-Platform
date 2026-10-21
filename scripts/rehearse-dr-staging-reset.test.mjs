import { describe, expect, it } from "vitest";
import { assertRehearsalTarget, rehearsalFailureCode, rehearsalEnvironment } from "./rehearse-dr-staging-reset.mjs";

describe("restored DR reset rehearsal boundary", () => {
  it("identifies the failed stage without exposing SQL, credentials or data", () => {
    const result = { stderr: "ERROR: cannot truncate a table referenced in a foreign key constraint (SQLSTATE 0A000) PRIVATE_DATA_SENTINEL", stdout: "private credentials", status: 1 };
    expect(rehearsalFailureCode(result, "REMOVE_FILES"))
      .toBe("REHEARSAL_REMOVE_FILES_FAILED_CANNOT_TRUNCATE_0A000");
    expect(rehearsalFailureCode({ stderr: "PRIVATE_DATA_SENTINEL", status: 1 }, "REMOTE_RESET"))
      .toBe("REHEARSAL_REMOTE_RESET_FAILED");
  });
  it("supplies loopback TLS policy after stripping every hosted database credential", () => {
    const environment = rehearsalEnvironment({ PATH: "tools", DR_DIRECT_URL: "private", PRIMARY_URL: "private",
      DATABASE_URL: "private", PGHOST: "hosted", PGSSLMODE: "require", SUPABASE_ACCESS_TOKEN: "private" });
    expect(environment).toEqual({ PATH: "tools", PGSSLMODE: "disable" });
  });
  it("reports only catalog-known object names and the migration filename", () => {
    const result = { stderr: 'Applying migration 20260101000000_fixture.sql...\nERROR: relation "schema_migrations" already exists (SQLSTATE 42P07) PRIVATE_DATA_SENTINEL' };
    expect(rehearsalFailureCode(result, "REMOTE_RESET", ["schema_migrations"]))
      .toBe("REHEARSAL_REMOTE_RESET_FAILED_ALREADY_EXISTS_42P07_OBJECT_SCHEMA_MIGRATIONS_MIGRATION_20260101000000_FIXTURE");
    expect(rehearsalFailureCode({ stderr: 'relation "PRIVATE_DATA_SENTINEL" already exists' }, "REMOTE_RESET", []))
      .toBe("REHEARSAL_REMOTE_RESET_FAILED_ALREADY_EXISTS");
  });
  it("accepts only the disposable loopback database, never either hosted project", () => {
    expect(() => assertRehearsalTarget("postgresql://supabase_admin:example-placeholder@127.0.0.1:54322/postgres?sslmode=disable")).not.toThrow();
    for (const url of [
      "postgresql://supabase_admin:example-placeholder@127.0.0.1:55432/postgres?sslmode=disable",
      "postgresql://postgres.daeqwtpaxcebmtwxqdkj:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
      "postgresql://postgres.eyuctbnlvnbnivwasvqr:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
      "postgresql://supabase_admin:example-placeholder@127.0.0.1:54322/postgres?host=evil.example&sslmode=disable",
    ]) expect(() => assertRehearsalTarget(url)).toThrow("REHEARSAL_TARGET_INVALID");
  });
});
