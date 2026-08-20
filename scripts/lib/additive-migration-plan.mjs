import { createHash } from "node:crypto";

const ANSI_PATTERN = /\u001b\[[0-9;]*m/gu;
const MIGRATION_VERSION_PATTERN = /^\d{14}$/u;
const IDENTIFIER_SOURCE = "[a-z_][a-z0-9_$]*";
const QUALIFIED_IDENTIFIER_SOURCE = `${IDENTIFIER_SOURCE}(?:\\.${IDENTIFIER_SOURCE})?`;
const QUALIFIED_IDENTIFIER_PATTERN = new RegExp(
  `^${QUALIFIED_IDENTIFIER_SOURCE}$`,
  "iu",
);

export class AdditiveMigrationPlanError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "AdditiveMigrationPlanError";
    this.code = code;
    this.details = details;
  }
}

export function parseSupabaseMigrationList(value) {
  return parseMigrationListContract(value).pendingVersions;
}

function parseMigrationListContract(value) {
  if (typeof value !== "string") {
    throw new AdditiveMigrationPlanError("MIGRATION_LIST_INVALID");
  }
  const rows = [];
  for (const line of value.replace(ANSI_PATTERN, "").split(/\r?\n/u)) {
    const match = line.match(
      /^\s*(?:(\d{14})|`(\d{14})`|`\s*`)?\s*[|│]\s*(?:(\d{14})|`(\d{14})`|`\s*`)?\s*[|│]/u,
    );
    if (!match) {
      const isHeader = /^\s*local\s*[|│]\s*remote\s*[|│]/iu.test(line);
      const isSeparator = /^\s*-+\s*[|│]\s*-+\s*[|│]/u.test(line);
      if (/[|│]/u.test(line) && !isHeader && !isSeparator) {
        throw new AdditiveMigrationPlanError("MIGRATION_LIST_UNPARSEABLE");
      }
      continue;
    }
    const local = match[1] || match[2] || null;
    const remote = match[3] || match[4] || null;
    if (!local && !remote) continue;
    rows.push({ local, remote });
  }
  if (rows.length === 0) {
    throw new AdditiveMigrationPlanError("MIGRATION_LIST_UNPARSEABLE");
  }

  const localVersions = new Set();
  const remoteVersions = new Set();
  const pendingVersions = [];
  for (const row of rows) {
    if (row.local) {
      if (!MIGRATION_VERSION_PATTERN.test(row.local) || localVersions.has(row.local)) {
        throw new AdditiveMigrationPlanError("MIGRATION_LIST_LOCAL_DUPLICATE");
      }
      localVersions.add(row.local);
    }
    if (row.remote) {
      if (!MIGRATION_VERSION_PATTERN.test(row.remote) || remoteVersions.has(row.remote)) {
        throw new AdditiveMigrationPlanError("MIGRATION_LIST_REMOTE_DUPLICATE");
      }
      remoteVersions.add(row.remote);
    }
    if (row.local && row.remote && row.local !== row.remote) {
      throw new AdditiveMigrationPlanError("MIGRATION_HISTORY_DIVERGED");
    }
    if (!row.local && row.remote) {
      throw new AdditiveMigrationPlanError("MIGRATION_HISTORY_REMOTE_ONLY");
    }
    if (row.local && !row.remote) pendingVersions.push(row.local);
  }
  return {
    localVersions: [...localVersions].sort(),
    pendingVersions: pendingVersions.sort(),
  };
}

export function createAdditiveMigrationPlan({ migrationList, migrationFiles }) {
  const { localVersions, pendingVersions } = parseMigrationListContract(migrationList);
  if (!Array.isArray(migrationFiles)) {
    throw new AdditiveMigrationPlanError("MIGRATION_FILES_INVALID");
  }
  const filesByVersion = new Map();
  for (const migration of migrationFiles) {
    if (
      !migration
      || typeof migration.file !== "string"
      || typeof migration.content !== "string"
    ) {
      throw new AdditiveMigrationPlanError("MIGRATION_FILE_INVALID");
    }
    const match = migration.file.match(/^(\d{14})_[a-z0-9_]+\.sql$/u);
    if (!match) continue;
    const entries = filesByVersion.get(match[1]) ?? [];
    entries.push(migration);
    filesByVersion.set(match[1], entries);
  }
  const repositoryVersions = [...filesByVersion.keys()].sort();
  if (stableJson(repositoryVersions) !== stableJson(localVersions)) {
    throw new AdditiveMigrationPlanError("MIGRATION_LIST_LOCAL_FILES_MISMATCH");
  }

  const migrations = pendingVersions.map((version) => {
    const matches = filesByVersion.get(version) ?? [];
    if (matches.length !== 1) {
      throw new AdditiveMigrationPlanError("PENDING_MIGRATION_FILE_NOT_EXACT", {
        versions: [version],
      });
    }
    const [migration] = matches;
    assertAdditiveMigrationSql(migration.content);
    return {
      version,
      file: migration.file,
      contentDigest: sha256(migration.content),
    };
  });
  const payload = {
    schemaVersion: 1,
    strategy: "ADDITIVE_ONLY",
    migrations,
  };
  return {
    ...payload,
    planDigest: sha256(stableJson(payload)),
  };
}

export function assertAdditiveMigrationSql(sql) {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new AdditiveMigrationPlanError("MIGRATION_SQL_INVALID");
  }
  const scan = scanSql(sql);
  assertDoBlocksSafe(scan);
  const statements = scan.scrubbedSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const functionReplacements = safeFunctionReplacements(statements);
  const replacements = replacementObjects(statements);
  assertRevokesTargetCreatedObjects(
    statements,
    functionReplacements.renamedFunctions,
  );
  assertCommentsTargetCreatedObjects(statements);

  for (const statement of statements) {
    if (functionReplacements.statements.has(statement)) continue;
    if (/^set\b/iu.test(statement)) assertSafeTimeout(statement);
    assertAllowedStatement(statement);
    if (
      /^drop\s+index\b/iu.test(statement)
      && !/^drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?[^\s,;]+(?:\s+restrict)?$/iu.test(statement)
    ) {
      throw new AdditiveMigrationPlanError("DROP_INDEX_CONTRACT_INVALID");
    }
    if (/\btruncate\b|\bdelete\s+from\b|\bthen\s+delete\b/iu.test(statement)) {
      throw new AdditiveMigrationPlanError("DESTRUCTIVE_DATA_CHANGE_FORBIDDEN");
    }
    if (
      /\balter\s+(?:table|type|view|materialized\s+view|function|procedure)\b[\s\S]*\brename\b/iu
        .test(statement)
      || /\balter\s+table\b[\s\S]*\bset\s+(?:schema|unlogged)\b/iu.test(statement)
      || /\balter\s+table\b[\s\S]*\bdisable\s+(?:trigger|row\s+level\s+security)\b/iu
        .test(statement)
      || /\balter\s+table\b[\s\S]*\bno\s+force\s+row\s+level\s+security\b/iu
        .test(statement)
      || /\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\b(?:type|set\s+data\s+type|set\s+not\s+null)\b/iu
        .test(statement)
    ) {
      throw new AdditiveMigrationPlanError("BACKWARD_INCOMPATIBLE_DDL_FORBIDDEN");
    }
    if (/\bexecute\s+(?:format\s*\(|['"])/iu.test(statement)) {
      throw new AdditiveMigrationPlanError("DYNAMIC_SQL_FORBIDDEN");
    }
    for (const drop of statement.matchAll(/\bdrop\s+([a-z_]+)/giu)) {
      const kind = drop[1].toLowerCase();
      if (!["trigger", "policy", "constraint", "index"].includes(kind)) {
        throw new AdditiveMigrationPlanError("DESTRUCTIVE_DDL_FORBIDDEN");
      }
    }
  }
  assertReplacementPairs(replacements);
  return true;
}

function assertRevokesTargetCreatedObjects(statements, renamedFunctions) {
  const createdAt = new Map(renamedFunctions);
  for (const [index, statement] of statements.entries()) {
    const table = statement.match(new RegExp(
      `^create\\s+table\\s+(${QUALIFIED_IDENTIFIER_SOURCE})`,
      "iu",
    ));
    if (table) {
      const identity = `table:${normalizeIdentifier(table[1])}`;
      if (!createdAt.has(identity)) createdAt.set(identity, index);
    }
    const functionIdentity = createFunctionIdentity(statement);
    if (functionIdentity) {
      const identity = `function:${functionIdentity}`;
      if (!createdAt.has(identity)) createdAt.set(identity, index);
    }
  }
  for (const [index, statement] of statements.entries()) {
    if (!/^revoke\b/iu.test(statement)) continue;
    const revoke = statement.match(new RegExp(
      "^revoke\\s+all(?:\\s+privileges)?\\s+on\\s+"
        + "(?:(table|function)\\s+)?([\\s\\S]*?)\\s+from\\s+"
        + `${IDENTIFIER_SOURCE}(?:\\s*,\\s*${IDENTIFIER_SOURCE})*$`,
      "iu",
    ));
    if (!revoke) {
      throw new AdditiveMigrationPlanError("REVOKE_STATEMENT_UNPARSEABLE");
    }
    const kind = revoke[1]?.toLowerCase() ?? "table";
    const targets = kind === "function"
      ? splitTopLevelComma(revoke[2]).map((target) => {
        const match = target.match(new RegExp(
          `^(${QUALIFIED_IDENTIFIER_SOURCE})\\s*\\(([^()]*)\\)$`,
          "iu",
        ));
        const argumentTypes = match
          ? functionArgumentTypes(match[2], false)
          : null;
        return argumentTypes
          ? `${normalizeIdentifier(match[1])}(${argumentTypes.join(",")})`
          : null;
      })
      : revoke[2].split(",").map((target) => target.trim()).filter(Boolean);
    if (
      targets.length === 0
      || targets.some((target) => (
        !target
        || (kind === "table" && !QUALIFIED_IDENTIFIER_PATTERN.test(target))
        || !createdAt.has(`${kind}:${normalizeIdentifier(target)}`)
        || createdAt.get(`${kind}:${normalizeIdentifier(target)}`) >= index
      ))
    ) {
      throw new AdditiveMigrationPlanError("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    }
  }
}

function assertCommentsTargetCreatedObjects(statements) {
  const createdTables = new Map();
  const createdFunctions = new Map();
  const addedColumns = new Map();
  for (const [index, statement] of statements.entries()) {
    const table = statement.match(new RegExp(
      `^create\\s+table\\s+(${QUALIFIED_IDENTIFIER_SOURCE})`,
      "iu",
    ));
    if (table && !createdTables.has(normalizeIdentifier(table[1]))) {
      createdTables.set(normalizeIdentifier(table[1]), index);
    }
    const functionIdentity = createFunctionIdentity(statement);
    if (functionIdentity && !createdFunctions.has(functionIdentity)) {
      createdFunctions.set(functionIdentity, index);
    }
    const alteredTable = statement.match(new RegExp(
      `^alter\\s+table\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s+`,
      "iu",
    ));
    if (!alteredTable) continue;
    for (const column of statement.matchAll(new RegExp(
      `\\badd\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENTIFIER_SOURCE})\\b`,
      "giu",
    ))) {
      const identity = `${normalizeIdentifier(alteredTable[1])}.${normalizeIdentifier(column[1])}`;
      if (!addedColumns.has(identity)) addedColumns.set(identity, index);
    }
  }
  for (const [index, statement] of statements.entries()) {
    if (!/^comment\s+on\b/iu.test(statement)) continue;
    const functionComment = statement.match(new RegExp(
      `^comment\\s+on\\s+function\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s*\\(([^()]*)\\)\\s+is\\s+[\\s\\S]+$`,
      "iu",
    ));
    if (functionComment) {
      const argumentTypes = functionArgumentTypes(functionComment[2], false);
      const identity = argumentTypes
        ? `${normalizeIdentifier(functionComment[1])}(${argumentTypes.join(",")})`
        : null;
      if (
        identity
        && createdFunctions.has(identity)
        && createdFunctions.get(identity) < index
      ) continue;
      throw new AdditiveMigrationPlanError("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    }
    const columnComment = statement.match(new RegExp(
      `^comment\\s+on\\s+column\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\.(${IDENTIFIER_SOURCE})\\s+is\\s+[\\s\\S]+$`,
      "iu",
    ));
    if (columnComment) {
      const table = normalizeIdentifier(columnComment[1]);
      const column = normalizeIdentifier(columnComment[2]);
      if (
        (createdTables.has(table) && createdTables.get(table) < index)
        || (
          addedColumns.has(`${table}.${column}`)
          && addedColumns.get(`${table}.${column}`) < index
        )
      ) continue;
      throw new AdditiveMigrationPlanError("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    }
    throw new AdditiveMigrationPlanError("COMMENT_STATEMENT_UNPARSEABLE");
  }
}

function assertSafeTimeout(statement) {
  const match = statement.match(
    /^set\s+(?:local\s+)?(lock_timeout|statement_timeout)\s*=\s*'(\d+)(ms|s|min)'$/iu,
  );
  if (!match) {
    throw new AdditiveMigrationPlanError("TIMEOUT_STATEMENT_UNSAFE");
  }
  const multiplier = match[3].toLowerCase() === "min"
    ? 60_000
    : match[3].toLowerCase() === "s"
      ? 1_000
      : 1;
  const milliseconds = Number(match[2]) * multiplier;
  const maximum = match[1].toLowerCase() === "lock_timeout" ? 60_000 : 1_800_000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > maximum) {
    throw new AdditiveMigrationPlanError("TIMEOUT_STATEMENT_UNSAFE");
  }
}

function safeFunctionReplacements(statements) {
  const createdIdentities = statements.map((statement, index) => ({
    identity: createFunctionIdentity(statement),
    index,
  })).filter((entry) => entry.identity);
  const safeStatements = new Set();
  const renamedFunctions = new Map();
  for (const [index, statement] of statements.entries()) {
    const match = statement.match(
      new RegExp(
        `^alter\\s+function\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s*\\(([\\s\\S]*?)\\)\\s+rename\\s+to\\s+(${IDENTIFIER_SOURCE})$`,
        "iu",
      ),
    );
    if (!match) continue;
    const argumentTypes = functionArgumentTypes(match[2], false);
    const originalName = normalizeIdentifier(match[1]);
    const originalIdentity = argumentTypes
      ? `${originalName}(${argumentTypes.join(",")})`
      : null;
    if (
      !originalIdentity
      || !createdIdentities.some((entry) => (
        entry.identity === originalIdentity && entry.index > index
      ))
    ) {
      throw new AdditiveMigrationPlanError(
        "UNPAIRED_FUNCTION_RENAME_FORBIDDEN",
      );
    }
    const separator = originalName.lastIndexOf(".");
    const schema = separator >= 0 ? originalName.slice(0, separator + 1) : "";
    safeStatements.add(statement);
    renamedFunctions.set(
      `function:${schema}${normalizeIdentifier(match[3])}(${argumentTypes.join(",")})`,
      index,
    );
  }
  return { statements: safeStatements, renamedFunctions };
}

function createFunctionIdentity(statement) {
  const match = statement.match(new RegExp(
    `^create\\s+(?:or\\s+replace\\s+)?function\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s*\\(([\\s\\S]*?)\\)\\s*returns\\b`,
    "iu",
  ));
  if (!match) return null;
  const argumentTypes = functionArgumentTypes(match[2], true);
  return argumentTypes
    ? `${normalizeIdentifier(match[1])}(${argumentTypes.join(",")})`
    : null;
}

function splitTopLevelComma(value) {
  const targets = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (depth < 0) return [];
    if (value[index] === "," && depth === 0) {
      targets.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return [];
  targets.push(value.slice(start).trim());
  return targets.filter(Boolean);
}

function functionArgumentTypes(value, declarationsIncludeNames) {
  if (value.trim() === "") return [];
  const types = [];
  for (const argument of value.split(",")) {
    const normalized = argument.trim().replace(/\s+(?:default|=)[\s\S]*$/iu, "");
    const type = declarationsIncludeNames
      ? normalized.match(/^(?:in\s+)?"?[a-z_][a-z0-9_$]*"?\s+([a-z_][a-z0-9_.]*(?:\[\])?)$/iu)?.[1]
      : normalized.match(/^([a-z_][a-z0-9_.]*(?:\[\])?)$/iu)?.[1];
    if (!type) return null;
    types.push(normalizeIdentifier(type));
  }
  return types;
}

function assertDoBlocksSafe(scan) {
  const statements = scan.scrubbedSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const lockIndex = statements.findIndex((statement) => (
    /^lock\s+table\s+public\.stalls\s+in\s+share\s+row\s+exclusive\s+mode$/iu
      .test(statement)
  ));
  const lockTimeoutIndex = statements.findIndex((statement) => (
    /^set\s+local\s+lock_timeout\s*=\s*'\d+(?:ms|s|min)'$/iu.test(statement)
  ));
  const statementTimeoutIndex = statements.findIndex((statement) => (
    /^set\s+local\s+statement_timeout\s*=\s*'\d+(?:ms|s|min)'$/iu.test(statement)
  ));
  const beginIndices = statements
    .map((statement, index) => (/^begin$/iu.test(statement) ? index : -1))
    .filter((index) => index >= 0);
  const commitIndices = statements
    .map((statement, index) => (/^commit$/iu.test(statement) ? index : -1))
    .filter((index) => index >= 0);
  const doStatementIndices = statements
    .map((statement, index) => (/^do\s+\$\$$/iu.test(statement) ? index : -1))
    .filter((index) => index >= 0);
  let safeCollisionAuditCount = 0;

  if (
    (beginIndices.length > 0 || commitIndices.length > 0)
    && (
      beginIndices.length !== 1
      || commitIndices.length !== 1
      || beginIndices[0] !== 0
      || commitIndices[0] !== statements.length - 1
    )
  ) {
    throw new AdditiveMigrationPlanError("TRANSACTION_WRAPPER_UNSAFE");
  }

  if (scan.doBlocks.length !== doStatementIndices.length) {
    throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
  }

  for (const [doBlockIndex, body] of scan.doBlocks.entries()) {
    const safeCreateEnum = /^\s*begin\s+create\s+type\s+(?:"?[a-z_][a-z0-9_$]*"?\.)?"?[a-z_][a-z0-9_$]*"?\s+as\s+enum\s*\(\s*'(?:[^']|'')+'(?:\s*,\s*'(?:[^']|'')+')*\s*\)\s*;\s*exception\s+when\s+duplicate_object\s+then\s+null\s*;\s*end\s*;?\s*$/iu;
    const safeCollisionAudit = /^\s*declare\s+collision_code\s+text\s*;\s*begin\s+select\s+pg_catalog\.lower\(stall\.code\)\s+into\s+collision_code\s+from\s+public\.stalls\s+stall\s+group\s+by\s+pg_catalog\.lower\(stall\.code\)\s+having\s+pg_catalog\.count\(\*\)\s*>\s*1\s+order\s+by\s+pg_catalog\.lower\(stall\.code\)\s+limit\s+1\s*;\s*if\s+found\s+then\s+raise\s+unique_violation\s+using\s+message\s*=\s*'GLOBAL_STALL_CODE_COLLISION'\s*,\s*detail\s*=\s*pg_catalog\.format\(\s*'normalized code %L already exists more than once'\s*,\s*collision_code\s*\)\s*,\s*constraint\s*=\s*'stalls_code_lower_guard'\s*;\s*end\s+if\s*;\s*end\s*;?\s*$/iu;
    const doStatementIndex = doStatementIndices[doBlockIndex] ?? -1;

    if (safeCollisionAudit.test(body)) {
      safeCollisionAuditCount += 1;
      if (
        safeCollisionAuditCount !== 1
        || beginIndices.length !== 1
        || commitIndices.length !== 1
        || lockTimeoutIndex < 0
        || statementTimeoutIndex < 0
        || lockIndex < 0
        || beginIndices[0] >= lockTimeoutIndex
        || beginIndices[0] >= statementTimeoutIndex
        || lockTimeoutIndex >= lockIndex
        || statementTimeoutIndex >= lockIndex
        || lockIndex >= doStatementIndex
        || doStatementIndex >= commitIndices[0]
        || commitIndices[0] !== statements.length - 1
      ) {
        throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
      }
      continue;
    }
    if (!safeCreateEnum.test(body)) {
      throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
    }
  }

  if (lockIndex >= 0 && safeCollisionAuditCount !== 1) {
    throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
  }
}

function assertAllowedStatement(statement) {
  const allowed = [
    /^alter\s+table\b/iu,
    /^alter\s+type\b[\s\S]*\badd\s+value\b/iu,
    /^create\s+(?:or\s+replace\s+)?function\b/iu,
    /^create\s+table\b/iu,
    /^create\s+(?:unique\s+)?index\b/iu,
    /^create\s+trigger\b/iu,
    /^create\s+policy\b/iu,
    /^create\s+type\b/iu,
    /^create\s+schema\b/iu,
    /^drop\s+(?:trigger|policy|index)\b/iu,
    /^revoke\b/iu,
    /^grant\b/iu,
    /^comment\s+on\s+(?:column|function)\b/iu,
    /^begin$/iu,
    /^commit$/iu,
    /^set\s+(?:local\s+)?(?:lock_timeout|statement_timeout)\s*=/iu,
    /^lock\s+table\s+public\.stalls\s+in\s+share\s+row\s+exclusive\s+mode$/iu,
    /^do\s+\$\$/iu,
  ].some((pattern) => pattern.test(statement));
  if (!allowed) {
    throw new AdditiveMigrationPlanError("MIGRATION_STATEMENT_FORBIDDEN");
  }
}

function replacementObjects(statements) {
  const events = new Map();
  for (const [statementIndex, statement] of statements.entries()) {
    const position = (matchIndex) => statementIndex * 1_000_000 + matchIndex;
    const tableMatch = statement.match(/\balter\s+table\s+(?:if\s+exists\s+)?([^\s,;]+)/iu);
    if (tableMatch) {
      const table = normalizeIdentifier(tableMatch[1]);
      for (const match of statement.matchAll(/\bdrop\s+constraint\s+(?:if\s+exists\s+)?([^\s,;]+)/giu)) {
        recordReplacementEvent(events, `constraint:${table}:${normalizeIdentifier(match[1])}`, "drop", position(match.index));
      }
      for (const match of statement.matchAll(/\badd\s+constraint\s+([^\s,;]+)/giu)) {
        recordReplacementEvent(events, `constraint:${table}:${normalizeIdentifier(match[1])}`, "create", position(match.index));
      }
    }
    const dropTrigger = statement.match(
      /\bdrop\s+trigger\s+(?:if\s+exists\s+)?([^\s;]+)\s+on\s+([^\s;]+)/iu,
    );
    if (dropTrigger) {
      recordReplacementEvent(events, replacementKey("trigger", dropTrigger[2], dropTrigger[1]), "drop", position(dropTrigger.index));
    }
    const createTrigger = statement.match(
      /\bcreate\s+trigger\s+([^\s;]+)[\s\S]*\bon\s+([^\s;]+)/iu,
    );
    if (createTrigger) {
      recordReplacementEvent(events, replacementKey("trigger", createTrigger[2], createTrigger[1]), "create", position(createTrigger.index));
    }
    const dropPolicy = statement.match(
      /\bdrop\s+policy\s+(?:if\s+exists\s+)?([^\s;]+)\s+on\s+([^\s;]+)/iu,
    );
    if (dropPolicy) {
      recordReplacementEvent(events, replacementKey("policy", dropPolicy[2], dropPolicy[1]), "drop", position(dropPolicy.index));
    }
    const createPolicy = statement.match(
      /\bcreate\s+policy\s+([^\s;]+)\s+on\s+([^\s;]+)/iu,
    );
    if (createPolicy) {
      recordReplacementEvent(events, replacementKey("policy", createPolicy[2], createPolicy[1]), "create", position(createPolicy.index));
    }
    const dropIndex = statement.match(
      /\bdrop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?([^\s;]+)/iu,
    );
    if (dropIndex) {
      recordReplacementEvent(events, `index:${normalizeIdentifier(dropIndex[1])}`, "drop", position(dropIndex.index));
    }
    const createIndex = statement.match(
      /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([^\s;]+)/iu,
    );
    if (createIndex) {
      recordReplacementEvent(events, `index:${normalizeIdentifier(createIndex[1])}`, "create", position(createIndex.index));
    }
  }
  return events;
}

function recordReplacementEvent(events, key, action, position) {
  const current = events.get(key) ?? [];
  current.push({ action, position });
  events.set(key, current);
}

function assertReplacementPairs(events) {
  const unpaired = [];
  for (const [key, objectEvents] of events) {
    const ordered = [...objectEvents].sort((left, right) => left.position - right.position);
    for (const [index, event] of ordered.entries()) {
      if (event.action !== "drop") continue;
      if (!ordered.slice(index + 1).some((candidate) => candidate.action === "create")) {
        unpaired.push(key);
        break;
      }
    }
  }
  if (unpaired.length > 0) {
    throw new AdditiveMigrationPlanError("UNPAIRED_OBJECT_DROP_FORBIDDEN", {
      objectKinds: [...new Set(unpaired.map((key) => key.split(":", 1)[0]))].sort(),
    });
  }
}

function replacementKey(kind, table, name) {
  return `${kind}:${normalizeIdentifier(table)}:${normalizeIdentifier(name)}`;
}

function normalizeIdentifier(value) {
  return value.includes('"') ? `quoted:${value}` : value.toLowerCase();
}

function scanSql(sql) {
  let output = "";
  let statementStart = 0;
  const doBlocks = [];
  for (let index = 0; index < sql.length;) {
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      if (end === -1) break;
      output += "\n";
      index = end + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (sql.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) {
        throw new AdditiveMigrationPlanError("MIGRATION_SQL_COMMENT_INVALID");
      }
      output += " ";
      continue;
    }
    if (sql[index] === "'") {
      let literal = "";
      let simpleLiteral = true;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          simpleLiteral = false;
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          break;
        } else {
          literal += sql[index];
          index += 1;
        }
      }
      output += simpleLiteral && /^\d+(?:ms|s|min)$/iu.test(literal)
        ? ` '${literal}' `
        : " '' ";
      continue;
    }
    if (sql[index] === "$") {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/u)?.[0];
      if (delimiter) {
        const bodyStart = index + delimiter.length;
        const end = sql.indexOf(delimiter, bodyStart);
        if (end === -1) {
          throw new AdditiveMigrationPlanError("MIGRATION_SQL_DOLLAR_QUOTE_INVALID");
        }
        if (/^do$/iu.test(output.slice(statementStart).trim())) {
          doBlocks.push(sql.slice(bodyStart, end));
        }
        output += " $$ ";
        index = end + delimiter.length;
        continue;
      }
    }
    output += sql[index];
    if (sql[index] === ";") statementStart = output.length;
    index += 1;
  }
  return { scrubbedSql: output, doBlocks };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}
