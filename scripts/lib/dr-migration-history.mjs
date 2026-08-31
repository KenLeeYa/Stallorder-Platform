import { createHash } from "node:crypto";

export const modernMigrationMetadataFrom = "20260729094000";

// The former Staging DR stored this audited prefix with split-statement metadata,
// while Primary used whole-file or repaired rows. Lock its version/name identity;
// every migration from the modern protected pipeline still requires exact SQL metadata.
const legacyMigrationCount = 52;
const legacyMigrationFirstVersion = "20260713000100";
const legacyMigrationLastVersion = "20260724175025";
const legacyMigrationIdentityDigest =
  "c9dcb6c185fb3b23cdc692f572d6fad17d164d24c9b5485f69a4e2f17dde81fd";
const migrationVersionPattern = /^\d{14}$/;
const approvedHistoricalMetadataRewrites = new Map([
  ["20260813133000", {
    name: "global_stall_code_guard",
    primaryStatementCount: 5,
    drStatementCount: 5,
    primaryStatementsDigest:
      "679d775e2d96f5d39621c2a0735681b399e88c2094becc34b1dde4197a9e6a5e",
    drStatementsDigest:
      "40cf03d0d1a17ae76143e9d0cb9daa6d5654c2f2af7796a3e170c3f002a28322",
  }],
  ["20260813194500", {
    name: "future_fulfillment_production_load",
    primaryStatementCount: 12,
    drStatementCount: 4,
    primaryStatementsDigest:
      "c670716986a01f7264a8d5b8bd9661336eff3117645183e5552c49d3a752099c",
    drStatementsDigest:
      "8da438dd906ae98d706758bc354b507bf89c39f9410872a1a051c37de8d8efc3",
  }],
]);

export class DrMigrationHistoryError extends Error {
  constructor(code) {
    super(code);
    this.name = "DrMigrationHistoryError";
    this.code = code;
  }
}

export function assertMigrationHistoriesCompatible(primaryRows, drRows) {
  const primary = validateMigrationHistory(primaryRows);
  const dr = validateMigrationHistory(drRows);

  if (primary.length !== dr.length) {
    throw new DrMigrationHistoryError("MIGRATION_HISTORY_MISMATCH");
  }

  for (let index = 0; index < primary.length; index += 1) {
    const primaryRow = primary[index];
    const drRow = dr[index];
    const statementsMatch =
      JSON.stringify(primaryRow.statements) === JSON.stringify(drRow.statements);
    const approvedHistoricalRewrite = !statementsMatch
      && isApprovedHistoricalMetadataRewrite({
        version: primaryRow.version,
        name: primaryRow.name,
        primaryStatementCount: primaryRow.statements.length,
        drStatementCount: drRow.statements.length,
        primaryStatementsDigest: statementsDigest(primaryRow.statements),
        drStatementsDigest: statementsDigest(drRow.statements),
      });
    if (
      primaryRow.version !== drRow.version
      || primaryRow.name !== drRow.name
      || (
        primaryRow.version >= modernMigrationMetadataFrom
        && !statementsMatch
        && !approvedHistoricalRewrite
      )
    ) {
      throw new DrMigrationHistoryError("MIGRATION_HISTORY_MISMATCH");
    }
  }
}

export function isApprovedHistoricalMetadataRewrite({
  version,
  name,
  primaryStatementCount,
  drStatementCount,
  primaryStatementsDigest,
  drStatementsDigest,
}) {
  const approved = approvedHistoricalMetadataRewrites.get(version);
  return approved?.name === name
    && approved.primaryStatementCount === primaryStatementCount
    && approved.drStatementCount === drStatementCount
    && approved.primaryStatementsDigest === primaryStatementsDigest
    && approved.drStatementsDigest === drStatementsDigest;
}

function statementsDigest(statements) {
  return createHash("sha256")
    .update(JSON.stringify(statements))
    .digest("hex");
}

function validateMigrationHistory(rows) {
  if (!Array.isArray(rows)) {
    throw new DrMigrationHistoryError("MIGRATION_HISTORY_INVALID");
  }

  const normalized = rows.map((row) => {
    if (
      !row
      || typeof row !== "object"
      || typeof row.version !== "string"
      || !migrationVersionPattern.test(row.version)
      || typeof row.name !== "string"
      || row.name.length === 0
      || (row.statements !== null && (
        !Array.isArray(row.statements)
        || row.statements.some((statement) => typeof statement !== "string")
      ))
    ) {
      throw new DrMigrationHistoryError("MIGRATION_HISTORY_INVALID");
    }
    return {
      version: row.version,
      name: row.name,
      statements: row.statements ?? [],
    };
  });

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].version >= normalized[index].version) {
      throw new DrMigrationHistoryError("MIGRATION_HISTORY_INVALID");
    }
  }

  const legacy = normalized.filter(
    (row) => row.version < modernMigrationMetadataFrom,
  );
  const legacyIdentityDigest = createHash("sha256")
    .update(JSON.stringify(legacy.map(({ version, name }) => ({ version, name }))))
    .digest("hex");
  if (
    legacy.length !== legacyMigrationCount
    || legacy[0]?.version !== legacyMigrationFirstVersion
    || legacy.at(-1)?.version !== legacyMigrationLastVersion
    || legacyIdentityDigest !== legacyMigrationIdentityDigest
    || normalized[legacy.length]?.version !== modernMigrationMetadataFrom
  ) {
    throw new DrMigrationHistoryError("MIGRATION_HISTORY_INVALID");
  }

  return normalized;
}
