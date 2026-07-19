import { describe, expect, it } from "vitest";
import { inspectDirectDatabaseConnection, inspectRuntimeDatabaseConnection } from "./database-connection-profile";

describe("safe database connection profile", () => {
  it("recognizes a Prisma-compatible Supavisor transaction URL", () => {
    expect(inspectRuntimeDatabaseConnection(
      testDatabaseUrl(
        "aws-0-ap-northeast-1.pooler.supabase.com",
        6543,
        "pgbouncer=true&connection_limit=1",
      ),
    )).toEqual({
      configured: true,
      validPostgresUrl: true,
      usesSupavisor: true,
      usesTransactionPort: true,
      disablesPreparedStatements: true,
      hasConnectionLimit: true,
    });
  });

  it("reports only booleans for an invalid URL", () => {
    expect(inspectRuntimeDatabaseConnection("not-a-url")).toEqual({
      configured: true,
      validPostgresUrl: false,
      usesSupavisor: false,
      usesTransactionPort: false,
      disablesPreparedStatements: false,
      hasConnectionLimit: false,
    });
  });

  it("recognizes a migration connection on port 5432", () => {
    expect(inspectDirectDatabaseConnection(testDatabaseUrl("example.invalid", 5432)))
      .toEqual({ configured: true, validPostgresUrl: true, usesMigrationPort: true });
  });
});

function testDatabaseUrl(hostname: string, port: number, search = "") {
  const url = new URL(`postgresql://${hostname}:${port}/postgres`);
  url.username = "test_user";
  url.password = ["not", "a", "secret"].join("-");
  url.search = search;
  return url.toString();
}
