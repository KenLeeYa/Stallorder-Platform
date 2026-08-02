import { createHash } from "node:crypto";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ACTOR_PATTERN = /^[A-Za-z0-9-]{1,39}$/u;
const MAX_PARAMETERS_BYTES = 4_096;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export const PRODUCTION_PLAN_TTL_MS = 24 * 60 * 60 * 1_000;

export const PRODUCTION_OPERATIONS = Object.freeze({
  "production-migrations": {
    workflowPath: ".github/workflows/production-readiness.yml",
    allowedPlanEvents: ["push", "workflow_dispatch"],
  },
  "production-dr-bootstrap": {
    workflowPath: ".github/workflows/production-dr-operations.yml",
    allowedPlanEvents: ["workflow_dispatch"],
  },
  "production-dr-drill": {
    workflowPath: ".github/workflows/production-dr-operations.yml",
    allowedPlanEvents: ["workflow_dispatch"],
  },
  "production-storage-canary": {
    workflowPath: ".github/workflows/production-dr-operations.yml",
    allowedPlanEvents: ["workflow_dispatch"],
  },
  "status-page-deploy": {
    workflowPath: ".github/workflows/status-page-deploy.yml",
    allowedPlanEvents: ["workflow_dispatch"],
  },
});

export function createProductionApprovalReceipt({
  repository,
  planRunId,
  commitSha,
  treeSha,
  stagingTreeSha,
  operation,
  parameters = {},
  requestedBy,
  createdAt = new Date(),
  ttlMs = PRODUCTION_PLAN_TTL_MS,
}) {
  const operationConfig = operationDefinition(operation);
  validateRepository(repository);
  validateRunId(planRunId);
  validateSha(commitSha, "COMMIT_SHA");
  validateSha(treeSha, "TREE_SHA");
  validateSha(stagingTreeSha, "STAGING_TREE_SHA");
  validateActor(requestedBy, "REQUESTED_BY");
  if (treeSha !== stagingTreeSha) throw approvalError("STAGING_TREE_MISMATCH");
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > PRODUCTION_PLAN_TTL_MS) {
    throw approvalError("PLAN_TTL_INVALID");
  }

  const normalizedParameters = normalizeParameters(parameters);
  const createdAtMs = dateMilliseconds(createdAt, "PLAN_CREATED_AT_INVALID");
  const payload = {
    schemaVersion: 1,
    repository,
    workflowPath: operationConfig.workflowPath,
    planRunId: String(planRunId),
    commitSha,
    treeSha,
    stagingTreeSha,
    operation,
    parameters: normalizedParameters,
    parametersDigest: sha256(stableJson(normalizedParameters)),
    requestedBy,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
  };

  return {
    ...payload,
    receiptDigest: sha256(stableJson(payload)),
  };
}

export function validateProductionApprovalReceipt({
  receipt,
  expected,
  runMetadata,
  now = new Date(),
}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw approvalError("PLAN_RECEIPT_INVALID");
  }
  if (receipt.schemaVersion !== 1) throw approvalError("PLAN_SCHEMA_UNSUPPORTED");

  const operationConfig = operationDefinition(expected.operation);
  validateRepository(expected.repository);
  validateRunId(expected.planRunId);
  validateSha(expected.commitSha, "COMMIT_SHA");
  validateSha(expected.treeSha, "TREE_SHA");
  validateSha(expected.stagingTreeSha, "STAGING_TREE_SHA");
  validateActor(expected.repositoryOwner, "REPOSITORY_OWNER");
  validateActor(expected.applyActor, "APPLY_ACTOR");
  if (expected.applyActor !== expected.repositoryOwner) {
    throw approvalError("APPLY_ACTOR_NOT_REPOSITORY_OWNER");
  }
  if (expected.treeSha !== expected.stagingTreeSha) {
    throw approvalError("STAGING_TREE_MISMATCH");
  }

  const normalizedParameters = normalizeParameters(expected.parameters ?? {});
  const comparisons = [
    [receipt.repository, expected.repository, "PLAN_REPOSITORY_MISMATCH"],
    [receipt.workflowPath, operationConfig.workflowPath, "PLAN_WORKFLOW_MISMATCH"],
    [String(receipt.planRunId), String(expected.planRunId), "PLAN_RUN_ID_MISMATCH"],
    [receipt.commitSha, expected.commitSha, "PLAN_COMMIT_MISMATCH"],
    [receipt.treeSha, expected.treeSha, "PLAN_TREE_MISMATCH"],
    [receipt.stagingTreeSha, expected.stagingTreeSha, "PLAN_STAGING_TREE_MISMATCH"],
    [receipt.operation, expected.operation, "PLAN_OPERATION_MISMATCH"],
    [receipt.requestedBy, expected.repositoryOwner, "PLAN_REQUESTER_NOT_REPOSITORY_OWNER"],
    [
      receipt.parametersDigest,
      sha256(stableJson(normalizedParameters)),
      "PLAN_PARAMETERS_MISMATCH",
    ],
  ];
  for (const [actual, wanted, errorCode] of comparisons) {
    if (actual !== wanted) throw approvalError(errorCode);
  }
  if (stableJson(receipt.parameters) !== stableJson(normalizedParameters)) {
    throw approvalError("PLAN_PARAMETERS_MISMATCH");
  }

  const { receiptDigest, ...payload } = receipt;
  if (receiptDigest !== sha256(stableJson(payload))) {
    throw approvalError("PLAN_RECEIPT_DIGEST_MISMATCH");
  }

  const nowMs = dateMilliseconds(now, "CURRENT_TIME_INVALID");
  const createdAtMs = dateMilliseconds(receipt.createdAt, "PLAN_CREATED_AT_INVALID");
  const expiresAtMs = dateMilliseconds(receipt.expiresAt, "PLAN_EXPIRES_AT_INVALID");
  if (createdAtMs > nowMs + MAX_CLOCK_SKEW_MS) {
    throw approvalError("PLAN_CREATED_IN_FUTURE");
  }
  if (expiresAtMs <= nowMs) throw approvalError("PLAN_EXPIRED");
  if (expiresAtMs - createdAtMs > PRODUCTION_PLAN_TTL_MS) {
    throw approvalError("PLAN_TTL_INVALID");
  }

  validateRunMetadata({
    runMetadata,
    operationConfig,
    expected,
    createdAtMs,
  });

  return {
    operation: expected.operation,
    planRunId: String(expected.planRunId),
    commitSha: expected.commitSha,
    expiresAt: receipt.expiresAt,
  };
}

export function stableJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw approvalError("PLAN_PARAMETERS_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  throw approvalError("PLAN_PARAMETERS_INVALID");
}

function validateRunMetadata({ runMetadata, operationConfig, expected, createdAtMs }) {
  if (!runMetadata || typeof runMetadata !== "object") {
    throw approvalError("PLAN_RUN_METADATA_INVALID");
  }
  const comparisons = [
    [String(runMetadata.id), String(expected.planRunId), "PLAN_RUN_METADATA_ID_MISMATCH"],
    [runMetadata.path, operationConfig.workflowPath, "PLAN_RUN_WORKFLOW_MISMATCH"],
    [runMetadata.head_branch, "main", "PLAN_RUN_BRANCH_MISMATCH"],
    [runMetadata.head_sha, expected.commitSha, "PLAN_RUN_COMMIT_MISMATCH"],
    [runMetadata.status, "completed", "PLAN_RUN_NOT_COMPLETED"],
    [runMetadata.conclusion, "success", "PLAN_RUN_NOT_SUCCESSFUL"],
    [runMetadata.actor?.login, expected.repositoryOwner, "PLAN_RUN_ACTOR_MISMATCH"],
  ];
  for (const [actual, wanted, errorCode] of comparisons) {
    if (actual !== wanted) throw approvalError(errorCode);
  }
  if (!operationConfig.allowedPlanEvents.includes(runMetadata.event)) {
    throw approvalError("PLAN_RUN_EVENT_INVALID");
  }
  const runCreatedAtMs = dateMilliseconds(
    runMetadata.created_at,
    "PLAN_RUN_CREATED_AT_INVALID",
  );
  const runUpdatedAtMs = dateMilliseconds(
    runMetadata.updated_at,
    "PLAN_RUN_UPDATED_AT_INVALID",
  );
  if (runCreatedAtMs > createdAtMs + MAX_CLOCK_SKEW_MS) {
    throw approvalError("PLAN_RECEIPT_PREDATES_RUN");
  }
  if (createdAtMs > runUpdatedAtMs + MAX_CLOCK_SKEW_MS) {
    throw approvalError("PLAN_RECEIPT_POSTDATES_RUN");
  }
}

function normalizeParameters(parameters) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw approvalError("PLAN_PARAMETERS_INVALID");
  }
  const serialized = stableJson(parameters);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PARAMETERS_BYTES) {
    throw approvalError("PLAN_PARAMETERS_TOO_LARGE");
  }
  return JSON.parse(serialized);
}

function operationDefinition(operation) {
  const definition = PRODUCTION_OPERATIONS[operation];
  if (!definition) throw approvalError("PRODUCTION_OPERATION_INVALID");
  return definition;
}

function validateRepository(repository) {
  if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)) {
    throw approvalError("REPOSITORY_INVALID");
  }
}

function validateRunId(runId) {
  if (!RUN_ID_PATTERN.test(String(runId))) throw approvalError("PLAN_RUN_ID_INVALID");
}

function validateSha(value, name) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw approvalError(`${name}_INVALID`);
  }
}

function validateActor(value, name) {
  if (typeof value !== "string" || !ACTOR_PATTERN.test(value)) {
    throw approvalError(`${name}_INVALID`);
  }
}

function dateMilliseconds(value, errorCode) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw approvalError(errorCode);
  return milliseconds;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function approvalError(code) {
  return new Error(code);
}
