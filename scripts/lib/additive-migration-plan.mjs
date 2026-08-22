import { createHash } from "node:crypto";

const ANSI_PATTERN = /\u001b\[[0-9;]*m/gu;
const MIGRATION_VERSION_PATTERN = /^\d{14}$/u;
const REPORT_DELIVERY_SCHEDULER_FUNCTION_BODY_SHA256 =
  "ed13e2ade80350ba6a7484c015c614e80f4bf0ba14e5821a0f7a036e313ad809";
const IDENTIFIER_SOURCE = "[a-z_][a-z0-9_$]*";
const QUALIFIED_IDENTIFIER_SOURCE = `${IDENTIFIER_SOURCE}(?:\\.${IDENTIFIER_SOURCE})?`;
const QUALIFIED_IDENTIFIER_PATTERN = new RegExp(
  `^${QUALIFIED_IDENTIFIER_SOURCE}$`,
  "iu",
);
const PHASE_THREE_HARD_LOCK_MIGRATION_DIGEST =
  "ae162738982526aa10d19d14fe4bd566a793bf678b928597bd33d5e8d832eaab";
const DR_STANDBY_COMPATIBLE_MIGRATION_DIGESTS = new Set([
  "166dffdee8dbeee3179130571bbce0a57502d53aa6cae8e5a69bfb134e111bba",
  "84ab43e0e0ddd6e3d437aed2952b7f576959cbe349723df1ab154e308dd107f0",
  "5d9adcac5bd34598422fe135b724cbd3e7195a3ee2fb09e15e6c5f5d4962b6b1",
  "3b4178d16bc60a0544cee71db7a0a67d7d0b7f9a2b0ac236d6db7fb171c1d3ab",
  "56f4909ea45809273d08da77353eaeb590fb46a2459a4d4a0c928627102cb155",
  "25151e6f8defb09d2d7f4559829dc127b35ca0ac56e58b823b10781371c395c6",
]);
const COMPATIBLE_FUNCTION_BODY_MIGRATION_DIGEST =
  "f5800627472b5df8278ff6a11f6d9a514201706e06021852b5bf5f37a67b8891";
const EXISTING_TABLE_TRIGGER_MIGRATION_DIGEST =
  "f05d1e7dc42860f348b7607fd792ddd0d961d2cb48035dfac5ed8fa3d2532999";
const INTEGRATED_PRINT_CENTER_MIGRATION_DIGEST =
  "06f65177462f6fba3e7ee683e10bc93ef675f4872273c464734ed908f670f80f";
const GLOBAL_STALL_CODE_ROLLOUT_MIGRATION_DIGEST =
  "529efb3b8385153595e85cb7c49b0c4a53d7fffccc35c3c9a31e8504e2b3dba4";
const REPORT_DELIVERY_SCHEDULER_MIGRATION_DIGEST =
  "f9a24ac81577694f9bfd74175aacf470d6b176371cf4ffe3066b98f54ebdd9fa";
const STAFF_KDS_SPECIAL_CLOSURES_MIGRATION_DIGEST =
  "4fc4d1baff60a0e3adf1da897f4ba1d8a3d99a754969b8c962743ffe824cd26e";
const STAFF_KDS_SPECIAL_CLOSURES_RECONCILIATION_MIGRATION_DIGEST =
  "4a812bc323348fad6f330a561ac2238fa9538c97ad0de0898f89c16e37406bd0";

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
  const phaseThreeHardLock = isApprovedPhaseThreeHardLockMigration(sql);
  const compatibleFunctionBodyMigration =
    isApprovedCompatibleFunctionBodyMigration(sql);
  const existingTableTriggerMigration =
    isApprovedExistingTableTriggerMigration(sql);
  const integratedPrintCenterMigration =
    isApprovedIntegratedPrintCenterMigration(sql);
  const staffKdsSpecialClosuresMigration =
    isApprovedStaffKdsSpecialClosuresMigration(sql);
  const drStandbyCompatibleMigration =
    phaseThreeHardLock || isApprovedDrStandbyCompatibleMigration(sql);
  const scan = scanSql(sql);
  assertDoBlocksSafe(scan, drStandbyCompatibleMigration);
  const statements = scan.scrubbedSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (statements.some((statement) => /^alter\s+function\b/iu.test(statement))) {
    throw new AdditiveMigrationPlanError(
      "FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN",
    );
  }
  assertFunctionDeclarationsParseable(statements);
  const replacements = replacementObjects(statements);
  assertRevokesTargetCreatedObjects(statements);
  assertCommentsTargetCreatedObjects(statements);

  for (const statement of statements) {
    if (/^set\b/iu.test(statement)) assertSafeTimeout(statement);
    if (
      /^update\b/iu.test(statement)
      && !(phaseThreeHardLock && isPhaseThreeHardLockCleanup(statement))
    ) {
      throw new AdditiveMigrationPlanError("MIGRATION_STATEMENT_FORBIDDEN");
    }
    if (/^insert\s+into\b/iu.test(statement)) {
      assertSafeFeatureFlagSeed(statement);
    }
    if (/^create\s+extension\b/iu.test(statement)) {
      assertSafeExtensionInstall(statement);
    }
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
    assertAllowedStatement(
      statement,
      phaseThreeHardLock,
      staffKdsSpecialClosuresMigration,
    );
  }
  assertReplacementPairs(replacements);
  assertSecurityObjectProvenance(
    statements,
    phaseThreeHardLock,
    compatibleFunctionBodyMigration,
    existingTableTriggerMigration,
    integratedPrintCenterMigration,
  );
  assertReplacementObjectProvenance(statements, replacements);
  return true;
}

function assertFunctionDeclarationsParseable(statements) {
  for (const statement of statements) {
    if (!/^create\s+(?:or\s+replace\s+)?function\b/iu.test(statement)) {
      continue;
    }
    if (parseFunctionDeclaration(statement)) continue;
    throw new AdditiveMigrationPlanError(
      /^create\s+or\s+replace\s+function\b/iu.test(statement)
        ? "FUNCTION_REPLACEMENT_EXISTING_OBJECT_FORBIDDEN"
        : "FUNCTION_DECLARATION_UNPARSEABLE",
    );
  }
}

function assertSecurityObjectProvenance(
  statements,
  phaseThreeHardLock,
  compatibleFunctionBodyMigration,
  existingTableTriggerMigration,
  integratedPrintCenterMigration,
) {
  const createdTables = new Map();
  const createdFunctions = new Map();
  const rlsEnabledTables = new Set();
  const rlsForcedTables = new Set();
  const tenantScopedPolicyTables = new Set();
  const functionsRevokedFromPublic = new Set();

  for (const [index, statement] of statements.entries()) {
    const table = statement.match(new RegExp(
      `^create\\s+table\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\b`,
      "iu",
    ));
    if (table && !createdTables.has(normalizeIdentifier(table[1]))) {
      createdTables.set(normalizeIdentifier(table[1]), index);
    }

    const functionDeclaration = parseFunctionDeclaration(statement);
    if (
      /^create\s+(?:or\s+replace\s+)?function\b/iu.test(statement)
      && !functionDeclaration
    ) {
      if (!/^create\s+or\s+replace\s+function\b/iu.test(statement)) {
        throw new AdditiveMigrationPlanError(
          "FUNCTION_DECLARATION_UNPARSEABLE",
        );
      }
      throw new AdditiveMigrationPlanError(
        "FUNCTION_REPLACEMENT_EXISTING_OBJECT_FORBIDDEN",
      );
    }
    if (functionDeclaration) {
      const createdAt = createdFunctions.get(functionDeclaration.identity);
      if (
        functionDeclaration.replaces
        && !(Number.isInteger(createdAt) && createdAt < index)
        && !compatibleFunctionBodyMigration
      ) {
        throw new AdditiveMigrationPlanError(
          "FUNCTION_REPLACEMENT_EXISTING_OBJECT_FORBIDDEN",
        );
      }
      if (!createdFunctions.has(functionDeclaration.identity)) {
        createdFunctions.set(functionDeclaration.identity, index);
      }
    }

    if (/^grant\b/iu.test(statement)) {
      assertGrantTargetsCreatedObjects(
        statement,
        index,
        createdTables,
        createdFunctions,
        rlsEnabledTables,
        rlsForcedTables,
        tenantScopedPolicyTables,
        functionsRevokedFromPublic,
      );
    }

    const alteredTable = statement.match(new RegExp(
      `^alter\\s+table\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s+([\\s\\S]+)$`,
      "iu",
    ));
    const securityTableMutation = /^alter\s+table\b/iu.test(statement)
      && (
        /\bowner\s+to\b/iu.test(statement)
        || /\b(?:enable|disable|force|no\s+force)\s+row\s+level\s+security\b/iu
          .test(statement)
        || /\b(?:enable|disable)\s+(?:(?:always|replica)\s+)?trigger\b/iu
          .test(statement)
      );
    if (securityTableMutation && !alteredTable) {
      throw new AdditiveMigrationPlanError(
        "SECURITY_MUTATION_STATEMENT_UNPARSEABLE",
      );
    }
    if (securityTableMutation) {
      assertObjectCreatedEarlier(
        createdTables,
        normalizeIdentifier(alteredTable[1]),
        index,
        "SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN",
      );
      const tableIdentity = normalizeIdentifier(alteredTable[1]);
      if (
        /\bowner\s+to\b/iu.test(alteredTable[2])
        && !/^owner\s+to\s+service_role$/iu.test(alteredTable[2])
      ) {
        throw new AdditiveMigrationPlanError("TABLE_OWNER_UNSAFE");
      }
      if (/\benable\s+row\s+level\s+security\b/iu.test(alteredTable[2])) {
        rlsEnabledTables.add(tableIdentity);
      }
      if (/\bforce\s+row\s+level\s+security\b/iu.test(alteredTable[2])) {
        rlsForcedTables.add(tableIdentity);
      }
    }

    const policy = statement.match(new RegExp(
      `^create\\s+policy\\s+${IDENTIFIER_SOURCE}\\s+on\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\b`,
      "iu",
    ));
    if (/^create\s+policy\b/iu.test(statement)) {
      if (!policy) {
        throw new AdditiveMigrationPlanError(
          "SECURITY_MUTATION_STATEMENT_UNPARSEABLE",
        );
      }
      assertObjectCreatedEarlier(
        createdTables,
        normalizeIdentifier(policy[1]),
        index,
        "SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN",
      );
      assertTenantScopedPolicy(statement);
      tenantScopedPolicyTables.add(normalizeIdentifier(policy[1]));
    }

    const trigger = statement.match(new RegExp(
      `^create\\s+trigger\\s+${IDENTIFIER_SOURCE}[\\s\\S]*?\\bon\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\b`,
      "iu",
    ));
    if (/^create\s+trigger\b/iu.test(statement)) {
      if (!trigger) {
        throw new AdditiveMigrationPlanError(
          "SECURITY_MUTATION_STATEMENT_UNPARSEABLE",
        );
      }
      const tableIdentity = normalizeIdentifier(trigger[1]);
      if (
        !objectWasCreatedEarlier(createdTables, tableIdentity, index)
        && !(
          phaseThreeHardLock
          && isPhaseThreeHardLockTrigger(statement, tableIdentity)
        )
        && !(
          existingTableTriggerMigration
          && (
            isGlobalStallCodeGuardTrigger(statement, tableIdentity)
            || (
              integratedPrintCenterMigration
              && isIntegratedPrintCenterTrigger(statement, tableIdentity)
            )
          )
        )
      ) {
        throw new AdditiveMigrationPlanError(
          "SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN",
        );
      }
    }

    const droppedSecurityObject = statement.match(new RegExp(
      `^drop\\s+(?:policy|trigger)\\s+(?:if\\s+exists\\s+)?${IDENTIFIER_SOURCE}\\s+on\\s+(${QUALIFIED_IDENTIFIER_SOURCE})$`,
      "iu",
    ));
    if (/^drop\s+(?:policy|trigger)\b/iu.test(statement)) {
      if (!droppedSecurityObject) {
        throw new AdditiveMigrationPlanError(
          "SECURITY_MUTATION_STATEMENT_UNPARSEABLE",
        );
      }
      const tableIdentity = normalizeIdentifier(droppedSecurityObject[1]);
      if (
        !objectWasCreatedEarlier(createdTables, tableIdentity, index)
        && !(
          existingTableTriggerMigration
          && isGlobalStallCodeGuardTrigger(statement, tableIdentity)
        )
      ) {
        throw new AdditiveMigrationPlanError(
          "SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN",
        );
      }
    }

    const publicRevoke = parseFunctionPublicRevoke(statement);
    if (publicRevoke) {
      for (const identity of publicRevoke) {
        functionsRevokedFromPublic.add(identity);
      }
    }
  }

  for (const identity of createdFunctions.keys()) {
    if (
      !functionsRevokedFromPublic.has(identity)
      && !compatibleFunctionBodyMigration
    ) {
      throw new AdditiveMigrationPlanError("FUNCTION_PUBLIC_REVOKE_REQUIRED");
    }
  }
}

function assertReplacementObjectProvenance(statements, replacements) {
  const createdTables = new Map();
  const indexCreations = new Map();

  for (const [index, statement] of statements.entries()) {
    const table = statement.match(new RegExp(
      `^create\\s+table\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\b`,
      "iu",
    ));
    if (table && !createdTables.has(normalizeIdentifier(table[1]))) {
      createdTables.set(normalizeIdentifier(table[1]), index);
    }
    const createdIndex = parseCreatedIndex(statement);
    if (createdIndex) {
      const creations = indexCreations.get(createdIndex.identity) ?? [];
      creations.push({
        index,
        table: createdIndex.table,
        conditional: createdIndex.conditional,
      });
      indexCreations.set(createdIndex.identity, creations);
    }
  }

  for (const [key, events] of replacements) {
    if (!events.some((event) => event.action === "drop")) continue;
    const firstDrop = Math.min(
      ...events.filter((event) => event.action === "drop")
        .map((event) => Math.floor(event.position / 1_000_000)),
    );
    const [kind, target] = key.split(":", 2);
    if (kind === "constraint") {
      const createdBeforeDrop = events.some((event) => (
        event.action === "create"
        && Math.floor(event.position / 1_000_000) < firstDrop
      ));
      if (
        !createdBeforeDrop
        && !objectWasCreatedEarlier(createdTables, target, firstDrop)
      ) {
        throw new AdditiveMigrationPlanError(
          "EXISTING_OBJECT_REPLACEMENT_FORBIDDEN",
        );
      }
      continue;
    }
    if (kind === "index") {
      const creations = indexCreations.get(target) ?? [];
      const created = creations.find((candidate) => candidate.index < firstDrop);
      if (
        !created
        || created.conditional
      ) {
        throw new AdditiveMigrationPlanError(
          "EXISTING_OBJECT_REPLACEMENT_FORBIDDEN",
        );
      }
      if (creations.some((candidate) => candidate.table !== created.table)) {
        throw new AdditiveMigrationPlanError(
          "INDEX_REPLACEMENT_RETARGET_FORBIDDEN",
        );
      }
    }
  }
}

function assertGrantTargetsCreatedObjects(
  statement,
  index,
  createdTables,
  createdFunctions,
  rlsEnabledTables,
  rlsForcedTables,
  tenantScopedPolicyTables,
  functionsRevokedFromPublic,
) {
  const tableGrant = statement.match(new RegExp(
    "^grant\\s+([\\s\\S]+?)\\s+on\\s+table\\s+"
      + `([\\s\\S]+?)\\s+to\\s+(${IDENTIFIER_SOURCE}(?:\\s*,\\s*${IDENTIFIER_SOURCE})*)$`,
    "iu",
  ));
  if (tableGrant) {
    const privileges = tableGrant[1].trim();
    const targets = tableGrant[2].split(",").map((target) => target.trim());
    const grantees = tableGrant[3].split(",").map((grantee) => (
      normalizeIdentifier(grantee.trim())
    ));
    if (
      targets.length === 0
      || targets.some((target) => (
        !QUALIFIED_IDENTIFIER_PATTERN.test(target)
        || !objectWasCreatedEarlier(
          createdTables,
          normalizeIdentifier(target),
          index,
        )
      ))
    ) {
      throw new AdditiveMigrationPlanError("GRANT_EXISTING_OBJECT_FORBIDDEN");
    }
    if (
      !isLeastPrivilegeTableGrant(privileges, grantees)
      || (
        grantees[0] === "authenticated"
        && targets.some((target) => {
          const identity = normalizeIdentifier(target);
          return !rlsEnabledTables.has(identity)
            || !rlsForcedTables.has(identity)
            || !tenantScopedPolicyTables.has(identity);
        })
      )
    ) {
      throw new AdditiveMigrationPlanError("TABLE_GRANT_EXPOSURE_FORBIDDEN");
    }
    return;
  }

  const functionGrant = statement.match(new RegExp(
    "^grant\\s+execute\\s+on\\s+function\\s+"
      + `([\\s\\S]+?)\\s+to\\s+(${IDENTIFIER_SOURCE}(?:\\s*,\\s*${IDENTIFIER_SOURCE})*)$`,
    "iu",
  ));
  if (functionGrant) {
    const targets = splitTopLevelComma(functionGrant[1]).map((target) => {
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
    });
    const grantees = functionGrant[2].split(",").map((grantee) => (
      normalizeIdentifier(grantee.trim())
    ));
    if (
      targets.length === 0
      || targets.some((target) => (
        !target
        || !objectWasCreatedEarlier(createdFunctions, target, index)
      ))
    ) {
      throw new AdditiveMigrationPlanError("GRANT_EXISTING_OBJECT_FORBIDDEN");
    }
    if (
      grantees.length === 0
      || grantees.some((grantee) => (
        !["anon", "authenticated", "service_role"].includes(grantee)
      ))
      || targets.some((target) => !functionsRevokedFromPublic.has(target))
      || (
        grantees.some((grantee) => grantee !== "service_role")
        && targets.some((target) => !target.startsWith("public."))
      )
    ) {
      throw new AdditiveMigrationPlanError("FUNCTION_GRANT_EXPOSURE_FORBIDDEN");
    }
    return;
  }

  throw new AdditiveMigrationPlanError("GRANT_STATEMENT_UNPARSEABLE");
}

function parseFunctionPublicRevoke(statement) {
  const match = statement.match(new RegExp(
    "^revoke\\s+all(?:\\s+privileges)?\\s+on\\s+function\\s+"
      + `([\\s\\S]+?)\\s+from\\s+(${IDENTIFIER_SOURCE}(?:\\s*,\\s*${IDENTIFIER_SOURCE})*)$`,
    "iu",
  ));
  if (!match) return null;
  const grantees = match[2].split(",").map((grantee) => (
    normalizeIdentifier(grantee.trim())
  ));
  if (!grantees.includes("public")) return null;
  const targets = splitTopLevelComma(match[1]).map((target) => {
    const targetMatch = target.match(new RegExp(
      `^(${QUALIFIED_IDENTIFIER_SOURCE})\\s*\\(([^()]*)\\)$`,
      "iu",
    ));
    const argumentTypes = targetMatch
      ? functionArgumentTypes(targetMatch[2], false)
      : null;
    return argumentTypes
      ? `${normalizeIdentifier(targetMatch[1])}(${argumentTypes.join(",")})`
      : null;
  });
  return targets.length > 0 && targets.every(Boolean) ? targets : null;
}

function isLeastPrivilegeTableGrant(privileges, grantees) {
  if (grantees.length !== 1) return false;
  if (grantees[0] === "authenticated") {
    return new RegExp(
      `^select\\s*\\(\\s*${IDENTIFIER_SOURCE}(?:\\s*,\\s*${IDENTIFIER_SOURCE})*\\s*\\)$`,
      "iu",
    ).test(privileges);
  }
  if (grantees[0] === "service_role") {
    const requested = privileges.split(",").map((privilege) => (
      privilege.trim().toLowerCase()
    ));
    return requested.length > 0
      && requested.every((privilege) => (
        ["select", "insert", "update", "delete"].includes(privilege)
      ));
  }
  return false;
}

function assertTenantScopedPolicy(statement) {
  const match = statement.match(new RegExp(
    `^create\\s+policy\\s+${IDENTIFIER_SOURCE}\\s+on\\s+${QUALIFIED_IDENTIFIER_SOURCE}`
      + "(?:\\s+as\\s+(?:permissive|restrictive))?"
      + "\\s+for\\s+select\\s+to\\s+authenticated"
      + "\\s+using\\s*\\(\\s*app_private\\.has_stall_role\\s*\\("
      + `\\s*(${QUALIFIED_IDENTIFIER_SOURCE})\\s*,\\s*([\\s\\S]+)\\)\\s*\\)$`,
    "iu",
  ));
  if (!match) {
    throw new AdditiveMigrationPlanError("POLICY_SCOPE_UNPROVEN");
  }
  const scopeColumn = normalizeIdentifier(match[1]);
  const scopeSegments = scopeColumn.split(".");
  if (scopeSegments.at(-1) !== "stall_id" || !isSafeRoleFilter(match[2])) {
    throw new AdditiveMigrationPlanError("POLICY_SCOPE_UNPROVEN");
  }
}

function isSafeRoleFilter(value) {
  const normalized = value.trim();
  if (/^null\s*::\s*public\.user_role\s*\[\s*\]$/iu.test(normalized)) {
    return true;
  }
  return /^array\s*\[\s*''(?:\s*::\s*public\.user_role)?(?:\s*,\s*''(?:\s*::\s*public\.user_role)?)*\s*\](?:\s*::\s*public\.user_role\s*\[\s*\])?$/iu
    .test(normalized);
}

function assertObjectCreatedEarlier(objects, identity, index, errorCode) {
  if (!objectWasCreatedEarlier(objects, identity, index)) {
    throw new AdditiveMigrationPlanError(errorCode);
  }
}

function objectWasCreatedEarlier(objects, identity, index) {
  const createdAt = objects.get(identity);
  return Number.isInteger(createdAt) && createdAt < index;
}

function assertRevokesTargetCreatedObjects(statements) {
  const createdAt = new Map();
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
  const createdTriggers = new Map();
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
    const trigger = statement.match(new RegExp(
      `^create\\s+trigger\\s+(${IDENTIFIER_SOURCE})[\\s\\S]*?\\bon\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\b`,
      "iu",
    ));
    if (trigger) {
      const identity = `${normalizeIdentifier(trigger[2])}:${normalizeIdentifier(trigger[1])}`;
      if (!createdTriggers.has(identity)) createdTriggers.set(identity, index);
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
    const tableComment = statement.match(new RegExp(
      `^comment\\s+on\\s+table\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s+is\\s+[\\s\\S]+$`,
      "iu",
    ));
    if (tableComment) {
      const table = normalizeIdentifier(tableComment[1]);
      if (createdTables.has(table) && createdTables.get(table) < index) continue;
      throw new AdditiveMigrationPlanError("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    }
    const triggerComment = statement.match(new RegExp(
      `^comment\\s+on\\s+trigger\\s+(${IDENTIFIER_SOURCE})\\s+on\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s+is\\s+[\\s\\S]+$`,
      "iu",
    ));
    if (triggerComment) {
      const identity = `${normalizeIdentifier(triggerComment[2])}:${normalizeIdentifier(triggerComment[1])}`;
      if (
        createdTriggers.has(identity)
        && createdTriggers.get(identity) < index
      ) continue;
      throw new AdditiveMigrationPlanError("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    }
    throw new AdditiveMigrationPlanError("COMMENT_STATEMENT_UNPARSEABLE");
  }
}

function assertSafeFeatureFlagSeed(statement) {
  const safeSeed = new RegExp(
    "^insert\\s+into\\s+public\\.resilience_feature_flags\\s*\\("
      + "\\s*code\\s*,\\s*description\\s*,\\s*default_enabled\\s*,\\s*is_emergency\\s*\\)"
      + "\\s*values\\s*\\(\\s*''\\s*,\\s*''\\s*,\\s*false\\s*,\\s*false\\s*\\)"
      + "\\s*on\\s+conflict\\s*\\(\\s*code\\s*\\)\\s+do\\s+nothing$",
    "iu",
  );
  if (!safeSeed.test(statement)) {
    throw new AdditiveMigrationPlanError("FEATURE_FLAG_SEED_UNSAFE");
  }
}

function isApprovedPhaseThreeHardLockMigration(sql) {
  return sha256(sql.replace(/\r\n/gu, "\n").trim())
    === PHASE_THREE_HARD_LOCK_MIGRATION_DIGEST;
}

function isApprovedDrStandbyCompatibleMigration(sql) {
  return DR_STANDBY_COMPATIBLE_MIGRATION_DIGESTS.has(
    sha256(sql.replace(/\r\n/gu, "\n").trim()),
  );
}

function isApprovedCompatibleFunctionBodyMigration(sql) {
  const digest = sha256(sql.replace(/\r\n/gu, "\n").trim());
  return digest === COMPATIBLE_FUNCTION_BODY_MIGRATION_DIGEST
    || digest === GLOBAL_STALL_CODE_ROLLOUT_MIGRATION_DIGEST
    || digest === REPORT_DELIVERY_SCHEDULER_MIGRATION_DIGEST
    || digest === STAFF_KDS_SPECIAL_CLOSURES_MIGRATION_DIGEST
    || digest === STAFF_KDS_SPECIAL_CLOSURES_RECONCILIATION_MIGRATION_DIGEST;
}

function isApprovedStaffKdsSpecialClosuresMigration(sql) {
  return sha256(sql.replace(/\r\n/gu, "\n").trim())
    === STAFF_KDS_SPECIAL_CLOSURES_MIGRATION_DIGEST;
}

function isApprovedExistingTableTriggerMigration(sql) {
  const digest = sha256(sql.replace(/\r\n/gu, "\n").trim());
  return digest === EXISTING_TABLE_TRIGGER_MIGRATION_DIGEST
    || digest === GLOBAL_STALL_CODE_ROLLOUT_MIGRATION_DIGEST
    || digest === INTEGRATED_PRINT_CENTER_MIGRATION_DIGEST;
}

function isApprovedIntegratedPrintCenterMigration(sql) {
  return sha256(sql.replace(/\r\n/gu, "\n").trim())
    === INTEGRATED_PRINT_CENTER_MIGRATION_DIGEST;
}

function isGlobalStallCodeGuardTrigger(statement, tableIdentity) {
  return tableIdentity === "public.stalls"
    && /^(?:create|drop)\s+trigger\s+(?:if\s+exists\s+)?stalls_validate_global_code_before_write\b/iu
      .test(statement);
}

function isIntegratedPrintCenterTrigger(statement, tableIdentity) {
  return tableIdentity === "public.orders"
    && /^create\s+trigger\s+orders_zz_route_integrated_print_jobs\b/iu.test(statement)
    && /\bafter\s+insert\s+or\s+update\s+of\s+status\s*,\s*payment_status\s+on\s+public\.orders\b/iu
      .test(statement)
    && /\bexecute\s+function\s+public\.route_integrated_order_print_jobs\s*\(\s*\)$/iu
      .test(statement);
}

function isPhaseThreeHardLockCleanup(statement) {
  const fiveCodes = "''\\s*,\\s*''\\s*,\\s*''\\s*,\\s*''\\s*,\\s*''";
  const overrideCleanup = new RegExp(
    "^update\\s+public\\.resilience_feature_flag_overrides\\s+flag_override"
      + "\\s+set\\s+enabled\\s*=\\s*false\\s*,\\s*reason\\s*=\\s*case"
      + "\\s+when\\s+position\\s*\\(\\s*''\\s+in\\s+flag_override\\.reason\\s*\\)\\s*>\\s*0"
      + "\\s+then\\s+flag_override\\.reason"
      + "\\s+else\\s+left\\s*\\(\\s*flag_override\\.reason\\s*\\|\\|\\s*''\\s*,\\s*500\\s*\\)"
      + "\\s+end\\s+from\\s+public\\.resilience_feature_flags\\s+flag"
      + "\\s+where\\s+flag_override\\.flag_id\\s*=\\s*flag\\.id"
      + "\\s+and\\s+flag_override\\.enabled"
      + `\\s+and\\s+flag\\.code\\s+in\\s*\\(\\s*${fiveCodes}\\s*\\)$`,
    "iu",
  );
  const catalogCleanup = new RegExp(
    "^update\\s+public\\.resilience_feature_flags"
      + "\\s+set\\s+default_enabled\\s*=\\s*false"
      + "\\s+where\\s+default_enabled"
      + `\\s+and\\s+code\\s+in\\s*\\(\\s*${fiveCodes}\\s*\\)$`,
    "iu",
  );
  return overrideCleanup.test(statement) || catalogCleanup.test(statement);
}

function isPhaseThreeHardLockTrigger(statement, tableIdentity) {
  const contracts = {
    "public.resilience_feature_flags": new RegExp(
      "^create\\s+trigger\\s+resilience_feature_flags_phase_three_lock_guard"
        + "\\s+before\\s+insert\\s+or\\s+update\\s+of\\s+code\\s*,\\s*default_enabled"
        + "\\s+on\\s+public\\.resilience_feature_flags"
        + "\\s+for\\s+each\\s+row\\s+execute\\s+function"
        + "\\s+app_private\\.enforce_phase_three_feature_flag_lock\\s*\\(\\s*\\)$",
      "iu",
    ),
    "public.resilience_feature_flag_overrides": new RegExp(
      "^create\\s+trigger\\s+resilience_feature_flag_overrides_phase_three_lock_guard"
        + "\\s+before\\s+insert\\s+or\\s+update\\s+of\\s+flag_id\\s*,\\s*enabled"
        + "\\s+on\\s+public\\.resilience_feature_flag_overrides"
        + "\\s+for\\s+each\\s+row\\s+execute\\s+function"
        + "\\s+app_private\\.enforce_phase_three_feature_flag_lock\\s*\\(\\s*\\)$",
      "iu",
    ),
  };
  return contracts[tableIdentity]?.test(statement) ?? false;
}

function assertSafeExtensionInstall(statement) {
  if (!/^create\s+extension\s+if\s+not\s+exists\s+btree_gist\s+with\s+schema\s+extensions$/iu.test(statement)) {
    throw new AdditiveMigrationPlanError("EXTENSION_INSTALL_UNSAFE");
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

function createFunctionIdentity(statement) {
  return parseFunctionDeclaration(statement)?.identity ?? null;
}

function parseFunctionDeclaration(statement) {
  const match = statement.match(new RegExp(
    `^create\\s+(or\\s+replace\\s+)?function\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\s*\\(([\\s\\S]*?)\\)\\s*returns\\b`,
    "iu",
  ));
  if (!match) return null;
  const argumentTypes = functionArgumentTypes(match[3], true);
  if (!argumentTypes) return null;
  return {
    identity: `${normalizeIdentifier(match[2])}(${argumentTypes.join(",")})`,
    replaces: Boolean(match[1]),
  };
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

function assertDoBlocksSafe(scan, drStandbyCompatibleMigration) {
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
  let safeReportDeliverySchedulerCount = 0;

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
    const safeReportDeliveryScheduler = /^\s*begin\s+perform\s+cron\.unschedule\(jobid\)\s+from\s+cron\.job\s+where\s+jobname\s*=\s*'stallorder-report-deliveries'\s*;\s*perform\s+cron\.schedule\(\s*'stallorder-report-deliveries'\s*,\s*'\*\/5 \* \* \* \*'\s*,\s*'select app_private\.invoke_due_report_deliveries\(\)'\s*\)\s*;\s*end\s*;?\s*$/iu;
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
    if (safeReportDeliveryScheduler.test(body)) {
      safeReportDeliverySchedulerCount += 1;
      const functionIndices = statements
        .map((statement, index) => (
          createFunctionIdentity(statement)
            === "app_private.invoke_due_report_deliveries()"
            ? index
            : -1
        ))
        .filter((index) => index >= 0);
      const functionBlocks = scan.functionBlocks.filter((block) => (
        createFunctionIdentity(`${block.prefix} $$`)
          === "app_private.invoke_due_report_deliveries()"
      ));
      const functionIndex = functionIndices[0] ?? -1;
      const functionBodyDigest = functionBlocks.length === 1
        ? sha256(functionBlocks[0].body.replace(/\r\n/gu, "\n").trim())
        : null;
      if (
        safeReportDeliverySchedulerCount !== 1
        || functionIndices.length !== 1
        || functionBlocks.length !== 1
        || functionBodyDigest !== REPORT_DELIVERY_SCHEDULER_FUNCTION_BODY_SHA256
        || beginIndices.length !== 1
        || commitIndices.length !== 1
        || functionIndex < 0
        || beginIndices[0] >= functionIndex
        || functionIndex >= doStatementIndex
        || doStatementIndex >= commitIndices[0]
      ) {
        throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
      }
      continue;
    }
    if (drStandbyCompatibleMigration) continue;
    if (!safeCreateEnum.test(body)) {
      throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
    }
  }

  if (lockIndex >= 0 && safeCollisionAuditCount !== 1) {
    throw new AdditiveMigrationPlanError("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
  }
}

function isAllowedAlterTableStatement(statement) {
  const table = statement.match(new RegExp(
    `^alter\\s+table\\s+(?:if\\s+exists\\s+)?${QUALIFIED_IDENTIFIER_SOURCE}\\s+([\\s\\S]+)$`,
    "iu",
  ));
  if (!table) return false;

  const localIdentifier = `(?:${IDENTIFIER_SOURCE}|"(?:[^"]|"")+")`;
  const allowedActions = [
    new RegExp(
      `^add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?(?!constraint\\b)${localIdentifier}\\s+[\\s\\S]+$`,
      "iu",
    ),
    new RegExp(
      `^add\\s+constraint\\s+${localIdentifier}\\s+[\\s\\S]+$`,
      "iu",
    ),
    new RegExp(
      `^drop\\s+constraint\\s+(?:if\\s+exists\\s+)?${localIdentifier}(?:\\s+restrict)?$`,
      "iu",
    ),
    new RegExp(`^owner\\s+to\\s+${localIdentifier}$`, "iu"),
    /^(?:enable|disable|force|no\s+force)\s+row\s+level\s+security$/iu,
    new RegExp(
      `^(?:enable|disable)\\s+(?:(?:always|replica)\\s+)?trigger\\s+(?:${localIdentifier}|all|user)$`,
      "iu",
    ),
  ];
  const actions = splitTopLevelComma(table[1]);
  return actions.length > 0 && actions.every((action) => (
    allowedActions.some((pattern) => pattern.test(action))
  ));
}

function assertAllowedStatement(
  statement,
  phaseThreeHardLock,
  staffKdsSpecialClosuresMigration,
) {
  const allowed = [
    phaseThreeHardLock && isPhaseThreeHardLockCleanup(statement),
    staffKdsSpecialClosuresMigration
      && /^alter\s+table\s+public\.stall_ordering_settings\s+alter\s+column\s+kds_module_enabled\s+set\s+default\s+false$/iu.test(statement),
    isAllowedAlterTableStatement(statement),
    /^alter\s+type\b[\s\S]*\badd\s+value\b/iu,
    /^create\s+(?:or\s+replace\s+)?function\b/iu,
    /^create\s+table\b/iu,
    /^create\s+(?:unique\s+)?index\b/iu,
    /^create\s+trigger\b/iu,
    /^create\s+policy\b/iu,
    /^create\s+type\b/iu,
    /^create\s+schema\b/iu,
    /^create\s+extension\b/iu,
    /^drop\s+(?:trigger|policy|index)\b/iu,
    /^revoke\b/iu,
    /^grant\b/iu,
    /^comment\s+on\s+(?:column|function|table|trigger)\b/iu,
    /^insert\s+into\s+public\.resilience_feature_flags\b/iu,
    /^begin$/iu,
    /^commit$/iu,
    /^set\s+(?:local\s+)?(?:lock_timeout|statement_timeout)\s*=/iu,
    /^lock\s+table\s+public\.stalls\s+in\s+share\s+row\s+exclusive\s+mode$/iu,
    /^do\s+\$\$/iu,
  ].some((pattern) => (
    typeof pattern === "boolean" ? pattern : pattern.test(statement)
  ));
  if (!allowed) {
    throw new AdditiveMigrationPlanError(
      /^alter\s+table\b/iu.test(statement)
        ? "ALTER_TABLE_ACTION_FORBIDDEN"
        : "MIGRATION_STATEMENT_FORBIDDEN",
    );
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

function parseCreatedIndex(statement) {
  const match = statement.match(new RegExp(
    `^create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(if\\s+not\\s+exists\\s+)?(${QUALIFIED_IDENTIFIER_SOURCE})\\s+on\\s+(${QUALIFIED_IDENTIFIER_SOURCE})\\b`,
    "iu",
  ));
  if (!match) return null;
  return {
    identity: normalizeIdentifier(match[2]),
    table: normalizeIdentifier(match[3]),
    conditional: Boolean(match[1]),
  };
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
  const functionBlocks = [];
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
    if (sql[index] === '"') {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
        } else if (sql[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      if (sql[index - 1] !== '"') {
        throw new AdditiveMigrationPlanError(
          "MIGRATION_SQL_QUOTED_IDENTIFIER_INVALID",
        );
      }
      output += sql.slice(start, index);
      continue;
    }
    if (sql[index] === "$") {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/u)?.[0];
      if (delimiter) {
        const prefix = output.slice(statementStart).trim();
        const bodyStart = index + delimiter.length;
        const end = sql.indexOf(delimiter, bodyStart);
        if (end === -1) {
          throw new AdditiveMigrationPlanError("MIGRATION_SQL_DOLLAR_QUOTE_INVALID");
        }
        if (/^do$/iu.test(prefix)) {
          doBlocks.push(sql.slice(bodyStart, end));
        } else if (/^create\s+(?:or\s+replace\s+)?function\b/iu.test(prefix)) {
          functionBlocks.push({ prefix, body: sql.slice(bodyStart, end) });
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
  return { scrubbedSql: output, doBlocks, functionBlocks };
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
