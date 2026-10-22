import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { classifyPreviewDbProbe } from "./report-preview-db-probe.mjs";

describe("Preview DB probe diagnostic", () => {
  it.each([
    ["PgClient: Connection timed out", "TIMEOUT"],
    ["timeout expired", "TIMEOUT"],
    ["password authentication failed for user postgres", "AUTHENTICATION"],
    ["Tenant or user not found", "TENANT_NOT_FOUND"],
    ["getaddrinfo EAI_AGAIN", "DNS"],
    ["connection refused", "CONNECTION_REFUSED"],
    ["remaining connection slots reserved", "CONNECTION_LIMIT"],
    ["unknown output", "UNCLASSIFIED"],
    ["x".repeat(65_537), "UNCLASSIFIED"],
  ])("categorizes probe case %# without forwarding raw output", (output, category) => {
    expect(classifyPreviewDbProbe(output)).toBe(category);
  });

  it("the real CLI emits only the category, never credentials, hosts or provider output", () => {
    const sentinel = "secret-sentinel-not-for-logs";
    const result = spawnSync(process.execPath, ["scripts/report-preview-db-probe.mjs"], {
      input: `postgresql://user:${sentinel}@private.example/db\nPgClient: Connection timed out\n${sentinel}`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output.trim()).toBe('PREVIEW_DB_PROBE_DIAGNOSTIC {"category":"TIMEOUT"}');
    expect(output).not.toContain(sentinel);
    expect(output).not.toContain("private.example");
  });
});
