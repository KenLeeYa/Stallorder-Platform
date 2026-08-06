import { createHash } from "node:crypto";

const ANSI_PATTERN = /\u001b\[[0-9;]*m/gu;
const MIGRATION_VERSION_PATTERN = /^\d{14}$/u;

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
    const match = line.match(/^\s*(\d{14})?\s*[|│]\s*(\d{14})?\s*[|│]/u);
    if (!match) continue;
    const local = match[1] || null;
    const remote = match[2] || null;
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
  assertDoBlocksSafe(sql);
  const statements = scrubSql(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const replacements = replacementObjects(statements);
  assertRevokesTargetCreatedObjects(statements);

  for (const statement of statements) {
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

function assertRevokesTargetCreatedObjects(statements) {
  const created = new Set();
  for (const statement of statements) {
    const table = statement.match(
      /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(;]+)/iu,
    );
    if (table) created.add(`table:${normalizeIdentifier(table[1])}`);
    const functions = statement.match(
      /\bcreate\s+(?:or\s+replace\s+)?function\s+([^\s(;]+)/iu,
    );
    if (functions) created.add(`function:${normalizeIdentifier(functions[1])}`);
  }
  for (const statement of statements) {
    const revoke = statement.match(
      /\brevoke\b[\s\S]*?\bon\s+(table|function)\s+([^\s(;]+)/iu,
    );
    if (!revoke) continue;
    const key = `${revoke[1].toLowerCase()}:${normalizeIdentifier(revoke[2])}`;
    if (!created.has(key)) {
      throw new AdditiveMigrationPlanError("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    }
  }
}

function assertDoBlocksSafe(sql) {
  for (const match of sql.matchAll(/\bdo\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1/giu)) {
    const body = match[2];
    const safeCreateEnum = /^\s*begin\s+create\s+type\s+(?:"?[a-z_][a-z0-9_$]*"?\.)?"?[a-z_][a-z0-9_$]*"?\s+as\s+enum\s*\(\s*'(?:[^']|'')+'(?:\s*,\s*'(?:[^']|'')+')*\s*\)\s*;\s*exception\s+when\s+duplicate_object\s+then\s+null\s*;\s*end\s*;?\s*$/iu;
    if (!safeCreateEnum.test(body)) {
      throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
    }
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
  return value.replaceAll('"', "").toLowerCase();
}

function scrubSql(sql) {
  let output = "";
  for (let index = 0; index < sql.length;) {
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      if (end === -1) return output;
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
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      output += " '' ";
      continue;
    }
    if (sql[index] === "$") {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/u)?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, index + delimiter.length);
        if (end === -1) {
          throw new AdditiveMigrationPlanError("MIGRATION_SQL_DOLLAR_QUOTE_INVALID");
        }
        output += " $$ ";
        index = end + delimiter.length;
        continue;
      }
    }
    output += sql[index];
    index += 1;
  }
  return output;
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
