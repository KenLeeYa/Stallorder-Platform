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
    if (
      primaryRow.version !== drRow.version
      || primaryRow.name !== drRow.name
      || (
        primaryRow.version >= modernMigrationMetadataFrom
        && JSON.stringify(primaryRow.statements) !== JSON.stringify(drRow.statements)
      )
    ) {
      throw new DrMigrationHistoryError("MIGRATION_HISTORY_MISMATCH");
    }
  }
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
