import { buildPublicationTableExpression } from "./dr-replication-scope.mjs";

export const acceptableSubscriptionRelationStates = Object.freeze([
  "i",
  "d",
  "f",
  "s",
  "r",
]);

const acceptableStateSet = new Set(acceptableSubscriptionRelationStates);

const expectedPublicationDefinition = Object.freeze({
  allTables: false,
  publishInsert: true,
  publishUpdate: true,
  publishDelete: true,
  publishTruncate: false,
  publishViaRoot: false,
});

export class DrReplicationPublicationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "DrReplicationPublicationError";
    this.code = code;
    this.details = details;
  }
}

export function assertPublicationContract({
  definition,
  allowlistedTables,
  publicationRows,
  columnsByTable,
  columnExclusions = {},
  requireComplete = false,
}) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new DrReplicationPublicationError("PUBLICATION_DEFINITION_INVALID");
  }
  const mismatchedFlags = Object.entries(expectedPublicationDefinition)
    .filter(([field, expected]) => definition[field] !== expected)
    .map(([field]) => field);
  if (mismatchedFlags.length > 0) {
    throw new DrReplicationPublicationError("PUBLICATION_DEFINITION_MISMATCH", {
      fields: mismatchedFlags,
    });
  }
  if (!(columnsByTable instanceof Map)) {
    throw new DrReplicationPublicationError("PUBLICATION_SOURCE_COLUMNS_INVALID");
  }

  const publicationDiff = diffAllowedPublicTables({
    allowlistedTables,
    actualRows: publicationRows,
    scope: "PUBLICATION",
  });
  const rowsByTable = new Map();
  for (const row of publicationRows) {
    const normalized = normalizePublicationRow(row);
    if (normalized.schemaName !== "public") continue;
    if (rowsByTable.has(normalized.tableName)) {
      throw new DrReplicationPublicationError("PUBLICATION_TABLE_DUPLICATED", {
        tables: [normalized.tableName],
      });
    }
    rowsByTable.set(normalized.tableName, normalized);
  }

  const sourceColumnsMissing = [];
  const columnListMismatches = [];
  const rowFilterMismatches = [];
  for (const table of publicationDiff.presentTables) {
    const sourceColumns = columnsByTable.get(table);
    if (!isUniqueNonEmptyStringArray(sourceColumns) || sourceColumns.length === 0) {
      sourceColumnsMissing.push(table);
      continue;
    }
    const exclusions = columnExclusions[table] ?? [];
    if (!isUniqueNonEmptyStringArray(exclusions)) {
      throw new DrReplicationPublicationError("PUBLICATION_COLUMN_EXCLUSIONS_INVALID");
    }
    if (exclusions.some((column) => !sourceColumns.includes(column))) {
      throw new DrReplicationPublicationError(
        "PUBLICATION_EXCLUDED_SOURCE_COLUMN_MISSING",
        { tables: [table] },
      );
    }
    const expectedColumns = sourceColumns.filter(
      (column) => !exclusions.includes(column),
    );
    const actual = rowsByTable.get(table);
    if (!sameStringArray(actual.columnNames, expectedColumns)) {
      columnListMismatches.push(table);
    }
    if (actual.rowFilter !== null) rowFilterMismatches.push(table);
  }
  if (sourceColumnsMissing.length > 0) {
    throw new DrReplicationPublicationError("PUBLICATION_SOURCE_COLUMNS_MISSING", {
      tables: sourceColumnsMissing,
    });
  }
  if (columnListMismatches.length > 0) {
    throw new DrReplicationPublicationError("PUBLICATION_COLUMN_LIST_MISMATCH", {
      tables: columnListMismatches,
    });
  }
  if (rowFilterMismatches.length > 0) {
    throw new DrReplicationPublicationError("PUBLICATION_ROW_FILTER_MISMATCH", {
      tables: rowFilterMismatches,
    });
  }
  if (requireComplete && publicationDiff.missingTables.length > 0) {
    throw new DrReplicationPublicationError("PUBLICATION_TABLES_MISSING", {
      missingTables: publicationDiff.missingTables,
    });
  }
  return publicationDiff;
}

export function assertSubscriptionContract({
  definition,
  publicationName,
  subscriptionName,
  drDirectUrl,
  primaryReplicationUrl,
  allowDisabled = false,
}) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_DEFINITION_INVALID");
  }
  const drIdentity = connectionContractFromPostgresUrl(
    drDirectUrl,
    "DR_ENDPOINT_IDENTITY_INVALID",
  ).identity;
  if (
    definition.currentDatabase !== drIdentity.database
    || definition.databaseName !== definition.currentDatabase
  ) {
    throw new DrReplicationPublicationError(
      "SUBSCRIPTION_CURRENT_DATABASE_MISMATCH",
    );
  }
  if (definition.enabled !== true && !(allowDisabled && definition.enabled === false)) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_ENABLED_MISMATCH");
  }
  if (!sameStringArray(definition.publications, [publicationName])) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_PUBLICATIONS_MISMATCH");
  }
  if (definition.slotName !== subscriptionName) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_SLOT_MISMATCH");
  }
  if (definition.streaming !== "t") {
    throw new DrReplicationPublicationError("SUBSCRIPTION_STREAMING_MISMATCH");
  }
  if (definition.twoPhaseState !== "d") {
    throw new DrReplicationPublicationError("SUBSCRIPTION_TWO_PHASE_MISMATCH");
  }

  const expectedPrimaryConnection = connectionContractFromPostgresUrl(
    primaryReplicationUrl,
    "PRIMARY_ENDPOINT_IDENTITY_INVALID",
  );
  if (
    expectedPrimaryConnection.hostAddressPresent
    || expectedPrimaryConnection.identityOverrides.length > 0
    || expectedPrimaryConnection.sslMode !== "require"
    || !hasRowSecurityOff(expectedPrimaryConnection.options)
  ) {
    throw new DrReplicationPublicationError(
      "PRIMARY_REPLICATION_SECURITY_OPTIONS_INVALID",
    );
  }
  const actualPrimaryConnection = connectionContractFromConninfo(
    definition.connectionInfo,
  );
  if (
    actualPrimaryConnection.hostAddressPresent
    || actualPrimaryConnection.identityOverrides.length > 0
    || !sameEndpointIdentity(
      actualPrimaryConnection.identity,
      expectedPrimaryConnection.identity,
    )
  ) {
    throw new DrReplicationPublicationError(
      "SUBSCRIPTION_ENDPOINT_IDENTITY_MISMATCH",
    );
  }
  if (
    actualPrimaryConnection.sslMode !== "require"
    || !hasRowSecurityOff(actualPrimaryConnection.options)
  ) {
    throw new DrReplicationPublicationError(
      "SUBSCRIPTION_SECURITY_OPTIONS_MISMATCH",
    );
  }

  return {
    currentDatabaseVerified: true,
    publicationVerified: true,
    slotVerified: true,
    endpointIdentityVerified: true,
    securityOptionsVerified: true,
  };
}

export function assertDrPhysicalPublicationContract({
  allowlistedTables,
  primaryColumnsByTable,
  drColumnsByTable,
  primaryPhysicalTables,
  drPhysicalTables,
  columnExclusions = {},
}) {
  const tables = validateTableList(
    allowlistedTables,
    "REPLICATION_ALLOWLIST_INVALID",
  );
  if (!(primaryColumnsByTable instanceof Map) || !(drColumnsByTable instanceof Map)) {
    throw new DrReplicationPublicationError("DR_PHYSICAL_COLUMNS_INVALID");
  }
  if (!(primaryPhysicalTables instanceof Map) || !(drPhysicalTables instanceof Map)) {
    throw new DrReplicationPublicationError("DR_PHYSICAL_TABLE_CONTRACT_INVALID");
  }

  const missingTables = [];
  const missingColumns = [];
  const incompatibleTables = [];
  const incompatibleColumns = [];
  const blockingTargetColumns = [];
  for (const table of tables) {
    const primaryColumns = primaryColumnsByTable.get(table);
    const drColumns = drColumnsByTable.get(table);
    if (!isUniqueNonEmptyStringArray(primaryColumns) || primaryColumns.length === 0) {
      throw new DrReplicationPublicationError("PUBLICATION_SOURCE_COLUMNS_MISSING", {
        tables: [table],
      });
    }
    if (!isUniqueNonEmptyStringArray(drColumns) || drColumns.length === 0) {
      missingTables.push(table);
      continue;
    }
    const primaryPhysical = normalizePhysicalTable(primaryPhysicalTables.get(table));
    const drPhysical = normalizePhysicalTable(drPhysicalTables.get(table));
    if (!primaryPhysical || !drPhysical) {
      missingTables.push(table);
      continue;
    }
    if (
      !["r", "p"].includes(primaryPhysical.kind)
      || primaryPhysical.kind !== drPhysical.kind
    ) {
      incompatibleTables.push(table);
      continue;
    }
    const exclusions = columnExclusions[table] ?? [];
    if (!isUniqueNonEmptyStringArray(exclusions)) {
      throw new DrReplicationPublicationError("PUBLICATION_COLUMN_EXCLUSIONS_INVALID");
    }
    const requiredColumns = primaryColumns.filter(
      (column) => !exclusions.includes(column),
    );
    const absent = requiredColumns.filter((column) => !drColumns.includes(column));
    if (absent.length > 0) {
      missingColumns.push({ table, columns: absent });
    }
    for (const column of requiredColumns) {
      const primaryColumn = primaryPhysical.columns.get(column);
      const drColumn = drPhysical.columns.get(column);
      if (!samePhysicalColumn(primaryColumn, drColumn)) {
        incompatibleColumns.push({ table, column });
      }
    }
    const requiredSet = new Set(requiredColumns);
    for (const [column, contract] of drPhysical.columns) {
      if (
        !requiredSet.has(column)
        && contract.notNull === true
        && contract.hasDefault !== true
        && contract.generated === ""
        && contract.identity === ""
      ) {
        blockingTargetColumns.push({ table, column });
      }
    }
  }
  if (missingTables.length > 0) {
    throw new DrReplicationPublicationError("DR_PHYSICAL_TABLES_MISSING", {
      tables: missingTables,
    });
  }
  if (missingColumns.length > 0) {
    throw new DrReplicationPublicationError("DR_PHYSICAL_COLUMNS_MISSING", {
      tables: missingColumns.map(({ table }) => table),
    });
  }
  if (incompatibleTables.length > 0) {
    throw new DrReplicationPublicationError("DR_PHYSICAL_TABLE_KIND_MISMATCH", {
      tables: incompatibleTables,
    });
  }
  if (incompatibleColumns.length > 0) {
    throw new DrReplicationPublicationError("DR_PHYSICAL_COLUMN_SIGNATURE_MISMATCH", {
      tables: [...new Set(incompatibleColumns.map(({ table }) => table))],
    });
  }
  if (blockingTargetColumns.length > 0) {
    throw new DrReplicationPublicationError("DR_TARGET_COLUMNS_BLOCK_REPLICATION", {
      tables: [...new Set(blockingTargetColumns.map(({ table }) => table))],
    });
  }
  return {
    verifiedTableCount: tables.length,
    verifiedPublishedColumnCount: tables.reduce((total, table) => (
      total + primaryColumnsByTable.get(table).filter(
        (column) => !(columnExclusions[table] ?? []).includes(column),
      ).length
    ), 0),
  };
}

function normalizePhysicalTable(value) {
  if (
    !value
    || typeof value.kind !== "string"
    || !(value.columns instanceof Map)
  ) {
    return null;
  }
  for (const [name, column] of value.columns) {
    if (
      typeof name !== "string"
      || !column
      || typeof column.dataType !== "string"
      || typeof column.notNull !== "boolean"
      || typeof column.generated !== "string"
      || typeof column.identity !== "string"
      || typeof column.hasDefault !== "boolean"
    ) {
      return null;
    }
  }
  return value;
}

function samePhysicalColumn(primary, dr) {
  return Boolean(primary && dr)
    && primary.dataType === dr.dataType
    && primary.notNull === dr.notNull
    && primary.generated === dr.generated
    && primary.identity === dr.identity;
}

export function assertSubscriptionScope({
  allowlistedTables,
  relationRows,
  requireComplete = false,
}) {
  const subscriptionDiff = diffAllowedPublicTables({
    allowlistedTables,
    actualRows: relationRows,
    scope: "SUBSCRIPTION",
  });
  const verifiedRelations = assertSubscriptionRelations({
    requiredTables: subscriptionDiff.presentTables,
    relationRows,
  });
  if (requireComplete && subscriptionDiff.missingTables.length > 0) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_RELATIONS_MISSING", {
      missingTables: subscriptionDiff.missingTables,
    });
  }
  return {
    ...subscriptionDiff,
    verifiedRelations,
    initializationState: verifiedRelations.every(({ state }) => state === "r")
      ? "READY"
      : "INITIATED",
  };
}

export async function waitForSubscriptionScope({
  allowlistedTables,
  readRelations,
  maxAttempts = 10,
  intervalMilliseconds = 1_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (
    typeof readRelations !== "function"
    || !Number.isSafeInteger(maxAttempts)
    || maxAttempts < 1
    || !Number.isSafeInteger(intervalMilliseconds)
    || intervalMilliseconds < 0
    || typeof sleep !== "function"
  ) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_WAIT_OPTIONS_INVALID");
  }

  let lastMissingTables = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return assertSubscriptionScope({
        allowlistedTables,
        relationRows: await readRelations(),
        requireComplete: true,
      });
    } catch (error) {
      if (
        !(error instanceof DrReplicationPublicationError)
        || error.code !== "SUBSCRIPTION_RELATIONS_MISSING"
      ) {
        throw error;
      }
      lastMissingTables = error.details.missingTables ?? [];
      if (attempt < maxAttempts) await sleep(intervalMilliseconds);
    }
  }
  throw new DrReplicationPublicationError(
    "SUBSCRIPTION_RELATIONS_NOT_INITIATED",
    { missingTables: lastMissingTables },
  );
}

export function classifyReplicationObjectState({
  publicationExists,
  subscriptionExists,
  requireExisting = false,
}) {
  if (
    typeof publicationExists !== "boolean"
    || typeof subscriptionExists !== "boolean"
    || typeof requireExisting !== "boolean"
  ) {
    throw new DrReplicationPublicationError("REPLICATION_OBJECT_STATE_INVALID");
  }
  if (!publicationExists && !subscriptionExists) {
    if (requireExisting) {
      throw new DrReplicationPublicationError(
        "REPLICATION_OBJECTS_REQUIRED_FOR_UPGRADE",
      );
    }
    return "CREATE";
  }
  if (publicationExists && subscriptionExists) return "UPGRADE";
  throw new DrReplicationPublicationError("REPLICATION_OBJECTS_PARTIAL_STATE", {
    publicationExists,
    subscriptionExists,
  });
}

export function buildReplicationUpgradePlan({
  publicationName,
  subscriptionName,
  allowlistedTables,
  publicationRows,
  subscriptionRelationRows,
  columnsByTable = new Map(),
}) {
  const publicationDiff = diffAllowedPublicTables({
    allowlistedTables,
    actualRows: publicationRows,
    scope: "PUBLICATION",
  });
  const subscriptionDiff = diffAllowedPublicTables({
    allowlistedTables,
    actualRows: subscriptionRelationRows,
    scope: "SUBSCRIPTION",
  });
  assertSubscriptionRelations({
    requiredTables: subscriptionDiff.presentTables,
    relationRows: subscriptionRelationRows,
  });

  const missingPublicationTables = publicationDiff.missingTables;
  const missingSubscriptionTables = subscriptionDiff.missingTables;
  const refreshRequired = missingPublicationTables.length > 0
    || missingSubscriptionTables.length > 0;
  const tableExpressions = missingPublicationTables.map((table) => (
    buildPublicationTableExpression(table, columnsByTable.get(table) ?? [])
  ));
  const addTablesStatement = buildAlterPublicationAddTablesStatement(
    publicationName,
    tableExpressions,
  );
  const refreshPublicationStatement = refreshRequired
    ? buildAlterSubscriptionRefreshStatement(subscriptionName)
    : null;
  const tablesToVerify = allowlistedTables.filter((table) => (
    missingPublicationTables.includes(table)
    || missingSubscriptionTables.includes(table)
  ));

  return {
    mode: missingPublicationTables.length > 0
      ? "ADD_TABLES_AND_REFRESH"
      : missingSubscriptionTables.length > 0
        ? "REFRESH_ONLY"
        : "NO_OP",
    missingPublicationTables,
    missingSubscriptionTables,
    tablesToVerify,
    primaryStatements: addTablesStatement ? [addTablesStatement] : [],
    drStatements: refreshPublicationStatement ? [refreshPublicationStatement] : [],
  };
}

export function diffAllowedPublicTables({
  allowlistedTables,
  actualRows,
  scope,
}) {
  const allowedTables = validateTableList(allowlistedTables, "REPLICATION_ALLOWLIST_INVALID");
  if (!Array.isArray(actualRows)) {
    throw new DrReplicationPublicationError(`${scope}_ROWS_INVALID`);
  }

  const allowedSet = new Set(allowedTables);
  const actualSet = new Set();
  const unexpectedTables = [];
  for (const row of actualRows) {
    const { schemaName, tableName } = normalizeRelationRow(row, `${scope}_ROW_INVALID`);
    if (schemaName !== "public" || !allowedSet.has(tableName)) {
      unexpectedTables.push(`${schemaName}.${tableName}`);
      continue;
    }
    actualSet.add(tableName);
  }

  if (unexpectedTables.length > 0) {
    throw new DrReplicationPublicationError(`${scope}_HAS_UNEXPECTED_TABLES`, {
      unexpectedTables: [...new Set(unexpectedTables)].sort(),
    });
  }

  return {
    presentTables: allowedTables.filter((table) => actualSet.has(table)),
    missingTables: allowedTables.filter((table) => !actualSet.has(table)),
  };
}

export function assertSubscriptionRelations({ requiredTables, relationRows }) {
  const required = validateTableList(
    requiredTables,
    "SUBSCRIPTION_REQUIRED_TABLES_INVALID",
  );
  if (!Array.isArray(relationRows)) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_ROWS_INVALID");
  }

  const relationsByTable = new Map();
  for (const row of relationRows) {
    const normalized = normalizeRelationRow(row, "SUBSCRIPTION_ROW_INVALID");
    if (normalized.schemaName !== "public") continue;
    relationsByTable.set(normalized.tableName, normalized.state);
  }

  const missingTables = required.filter((table) => !relationsByTable.has(table));
  if (missingTables.length > 0) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_RELATIONS_MISSING", {
      missingTables,
    });
  }

  const invalidStates = required
    .map((table) => ({ table, state: relationsByTable.get(table) }))
    .filter(({ state }) => !acceptableStateSet.has(state));
  if (invalidStates.length > 0) {
    throw new DrReplicationPublicationError(
      "SUBSCRIPTION_RELATION_STATE_UNACCEPTABLE",
      { invalidStates },
    );
  }

  return required.map((table) => ({ table, state: relationsByTable.get(table) }));
}

export function buildAlterPublicationAddTablesStatement(
  publicationName,
  tableExpressions,
) {
  if (!Array.isArray(tableExpressions)) {
    throw new DrReplicationPublicationError("PUBLICATION_TABLE_EXPRESSIONS_INVALID");
  }
  if (tableExpressions.length === 0) return null;
  if (tableExpressions.some((expression) => (
    typeof expression !== "string" || expression.trim().length === 0
  ))) {
    throw new DrReplicationPublicationError("PUBLICATION_TABLE_EXPRESSION_INVALID");
  }
  return `alter publication ${quoteIdentifier(publicationName)} add table ${tableExpressions.join(", ")}`;
}

export function buildAlterSubscriptionRefreshStatement(subscriptionName) {
  return `alter subscription ${quoteIdentifier(subscriptionName)} refresh publication with (copy_data = true)`;
}

export function quoteIdentifier(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new DrReplicationPublicationError("POSTGRES_IDENTIFIER_INVALID");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function validateTableList(tables, errorCode) {
  if (
    !Array.isArray(tables)
    || tables.some((table) => typeof table !== "string" || table.length === 0)
    || new Set(tables).size !== tables.length
  ) {
    throw new DrReplicationPublicationError(errorCode);
  }
  return [...tables];
}

function normalizeRelationRow(row, errorCode) {
  if (
    !row
    || typeof row.schemaName !== "string"
    || row.schemaName.length === 0
    || typeof row.tableName !== "string"
    || row.tableName.length === 0
  ) {
    throw new DrReplicationPublicationError(errorCode);
  }
  return {
    schemaName: row.schemaName,
    tableName: row.tableName,
    state: typeof row.state === "string" ? row.state : null,
  };
}

function normalizePublicationRow(row) {
  const normalized = normalizeRelationRow(row, "PUBLICATION_ROW_INVALID");
  if (!isUniqueNonEmptyStringArray(row.columnNames)) {
    throw new DrReplicationPublicationError("PUBLICATION_COLUMN_LIST_INVALID", {
      tables: [normalized.tableName],
    });
  }
  if (row.rowFilter !== null) {
    if (typeof row.rowFilter !== "string" || row.rowFilter.length === 0) {
      throw new DrReplicationPublicationError("PUBLICATION_ROW_FILTER_INVALID", {
        tables: [normalized.tableName],
      });
    }
  }
  return {
    ...normalized,
    columnNames: [...row.columnNames],
    rowFilter: row.rowFilter,
  };
}

function connectionContractFromPostgresUrl(value, errorCode) {
  let parsed;
  try {
    parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new DrReplicationPublicationError(errorCode);
  }
  const parameters = uniqueConnectionParameters(
    [...parsed.searchParams.entries()],
    errorCode,
  );
  const contract = {
    identity: {
      host: normalizeHost(parsed.hostname),
      port: parsed.port || "5432",
      database: decodeUrlComponent(parsed.pathname.replace(/^\/+/, "")),
      user: decodeUrlComponent(parsed.username),
    },
    hostAddressPresent: parameters.has("hostaddr"),
    identityOverrides: ["host", "port", "dbname", "database", "user", "password"]
      .filter((name) => parameters.has(name)),
    sslMode: normalizedOptionalValue(parameters.get("sslmode")),
    options: normalizedOptionalValue(parameters.get("options")),
  };
  if (Object.values(contract.identity).some((entry) => entry.length === 0)) {
    throw new DrReplicationPublicationError(errorCode);
  }
  return contract;
}

function connectionContractFromConninfo(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_CONNECTION_INFO_INVALID");
  }
  if (/^postgres(?:ql)?:\/\//iu.test(value.trim())) {
    return connectionContractFromPostgresUrl(
      value.trim(),
      "SUBSCRIPTION_CONNECTION_INFO_INVALID",
    );
  }

  const entries = parseLibpqConninfo(value);
  const contract = {
    identity: {
      host: normalizeHost(entries.host ?? ""),
      port: entries.port || "5432",
      database: entries.dbname ?? "",
      user: entries.user ?? "",
    },
    hostAddressPresent: Object.hasOwn(entries, "hostaddr"),
    identityOverrides: [],
    sslMode: normalizedOptionalValue(entries.sslmode),
    options: normalizedOptionalValue(entries.options),
  };
  if (Object.values(contract.identity).some((entry) => entry.length === 0)) {
    throw new DrReplicationPublicationError("SUBSCRIPTION_CONNECTION_INFO_INVALID");
  }
  return contract;
}

function parseLibpqConninfo(value) {
  const result = {};
  let index = 0;
  while (index < value.length) {
    while (/\s/u.test(value[index] ?? "")) index += 1;
    if (index >= value.length) break;
    const keyStart = index;
    while (/[A-Za-z0-9_]/u.test(value[index] ?? "")) index += 1;
    const key = value.slice(keyStart, index);
    while (/\s/u.test(value[index] ?? "")) index += 1;
    if (!key || value[index] !== "=") {
      throw new DrReplicationPublicationError("SUBSCRIPTION_CONNECTION_INFO_INVALID");
    }
    index += 1;
    while (/\s/u.test(value[index] ?? "")) index += 1;
    let parsedValue = "";
    if (value[index] === "'") {
      index += 1;
      let closed = false;
      while (index < value.length) {
        if (value[index] === "\\") {
          index += 1;
          if (index >= value.length) break;
          parsedValue += value[index];
          index += 1;
        } else if (value[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          parsedValue += value[index];
          index += 1;
        }
      }
      if (!closed) {
        throw new DrReplicationPublicationError("SUBSCRIPTION_CONNECTION_INFO_INVALID");
      }
    } else {
      while (index < value.length && !/\s/u.test(value[index])) {
        if (value[index] === "\\") {
          index += 1;
          if (index >= value.length) {
            throw new DrReplicationPublicationError(
              "SUBSCRIPTION_CONNECTION_INFO_INVALID",
            );
          }
        }
        parsedValue += value[index];
        index += 1;
      }
    }
    const normalizedKey = key.toLowerCase();
    if (Object.hasOwn(result, normalizedKey)) {
      throw new DrReplicationPublicationError("SUBSCRIPTION_CONNECTION_INFO_INVALID");
    }
    result[normalizedKey] = parsedValue;
  }
  return result;
}

function normalizeHost(value) {
  return value.trim().replace(/^\[|\]$/gu, "").toLowerCase();
}

function normalizedOptionalValue(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasRowSecurityOff(value) {
  if (typeof value !== "string") return false;
  const pattern = /(?:^|\s)(?:-c\s*|--)row_security=([^\s]+)/giu;
  const assignments = [...value.matchAll(pattern)];
  if (
    assignments.length !== 1
    || assignments[0][1].toLowerCase() !== "off"
  ) {
    return false;
  }
  return !value.replace(pattern, " ").match(/row_security/iu);
}

function uniqueConnectionParameters(entries, errorCode) {
  const parameters = new Map();
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (parameters.has(name)) {
      throw new DrReplicationPublicationError(errorCode);
    }
    parameters.set(name, value);
  }
  return parameters;
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function sameEndpointIdentity(left, right) {
  return left.host === right.host
    && left.port === right.port
    && left.database === right.database
    && left.user === right.user;
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual)
    && Array.isArray(expected)
    && actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

function isUniqueNonEmptyStringArray(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length;
}
