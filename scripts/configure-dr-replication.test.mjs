import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(
  new URL("./configure-dr-replication.mjs", import.meta.url),
);

describe("configure DR replication dry-run", () => {
  it("describes create-or-upgrade without validating or connecting database URLs", () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      "--source",
      "PRIMARY",
      "--target",
      "DR",
    ], {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        DIRECT_URL: "dry-run-must-not-read-this",
        DR_DIRECT_URL: "dry-run-must-not-read-this",
        PRIMARY_REPLICATION_URL: "dry-run-must-not-read-this",
      },
    });
    const plan = JSON.parse(output);

    expect(plan).toMatchObject({
      mode: "dry-run",
      strategy: "CREATE_OR_UPGRADE",
      replicatedTableCount: 118,
      dryRunGuarantees: {
        connectsToDatabases: false,
        changesRemoteState: false,
      },
    });
    expect(plan.createOrUpgrade).toEqual(expect.arrayContaining([
      expect.stringContaining("初建"),
      expect.stringContaining("ADD"),
      expect.stringContaining("no-op"),
    ]));
  });

  it("validates exact catalog identity before rollback and after refresh", () => {
    const source = readFileSync(scriptPath, "utf8");
    const rollbackStart = source.indexOf("if (rollback) {");
    const rollbackEnd = source.indexOf("} else {", rollbackStart);
    const rollbackSource = source.slice(rollbackStart, rollbackEnd);

    expect(source).toContain('tables.attnames::text[] as "columnNames"');
    expect(source).toContain('tables.rowfilter as "rowFilter"');
    expect(source).toContain('subscription.subconninfo as "connectionInfo"');
    expect(source).toContain('subscription.subtwophasestate::text as "twoPhaseState"');
    expect(source).toContain('statements::text[] as statements');
    expect(source).toContain("assertMigrationHistoriesCompatible(primaryHistory, drHistory)");
    expect(source).toContain("assertAllTablesHavePrimaryKeys(primary)");
    expect(source).toContain("assertAllTablesHavePrimaryKeys(dr)");
    expect(source).toContain('relation.relkind::text as "tableKind"');
    expect(source).toContain('pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)');
    expect(source).toContain("await verifyExactReplicationContract({");
    const emptinessCheck = source.indexOf(
      "const initialCopyTargetEmptiness = await verifyInitialCopyTargetsEmpty({",
    );
    const primaryUpgradeMutation = source.indexOf(
      "for (const statement of upgradePlan.primaryStatements)",
    );
    const drRefreshMutation = source.indexOf(
      "for (const statement of upgradePlan.drStatements)",
    );
    expect(emptinessCheck).toBeGreaterThan(-1);
    expect(emptinessCheck).toBeLessThan(primaryUpgradeMutation);
    expect(emptinessCheck).toBeLessThan(drRefreshMutation);
    expect(source).toContain("initialCopyTargetEmptiness,");
    expect(rollbackSource.indexOf("assertPublicationContract({")).toBeLessThan(
      rollbackSource.indexOf("drop publication"),
    );
    expect(rollbackSource.indexOf("assertSubscriptionContract({")).toBeLessThan(
      rollbackSource.indexOf("drop subscription"),
    );
  });

  it("describes an existing-only incremental operation without connecting", () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      "--source",
      "PRIMARY",
      "--target",
      "DR",
      "--upgrade-only",
    ], {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        DIRECT_URL: "must-not-connect",
        DR_DIRECT_URL: "must-not-connect",
        PRIMARY_REPLICATION_URL: "must-not-connect",
      },
    });

    const plan = JSON.parse(output);
    expect(plan).toMatchObject({
      mode: "dry-run",
      strategy: "UPGRADE_ONLY",
      upgradeOnly: expect.arrayContaining([
        expect.stringContaining("fail closed"),
        expect.stringContaining("ADD"),
      ]),
      dryRunGuarantees: {
        connectsToDatabases: false,
        changesRemoteState: false,
      },
    });
    expect(plan).not.toHaveProperty("createOrUpgrade");
  });
});
