import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createProductionApprovalReceipt,
  createProductionOperationEvidence,
  validateProductionApprovalReceipt,
  validateProductionOperationEvidence,
} from "./lib/production-approval.mjs";

const [command] = process.argv.slice(2);

try {
  if (command === "create") {
    await createReceipt();
  } else if (command === "verify") {
    await verifyReceipt();
  } else if (command === "create-evidence") {
    await createEvidence();
  } else if (command === "verify-evidence") {
    await verifyEvidence();
  } else {
    throw new Error("APPROVAL_COMMAND_INVALID");
  }
} catch (error) {
  console.error(JSON.stringify({
    event: "production_approval_failed",
    reason: safeReason(error),
  }));
  process.exitCode = 1;
}

async function createEvidence() {
  const outputPath = resolve(required("PRODUCTION_EVIDENCE_PATH"));
  const context = workflowContext();
  requireOwnerActor(context);
  const evidence = createProductionOperationEvidence({
    repository: context.repository,
    runId: context.runId,
    commitSha: context.commitSha,
    treeSha: git("rev-parse", "HEAD^{tree}"),
    operation: required("PRODUCTION_APPROVAL_OPERATION"),
    completedBy: context.actor,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(JSON.stringify({
    event: "production_operation_evidence_created",
    operation: evidence.operation,
    runId: evidence.runId,
  }));
}

async function verifyEvidence() {
  const evidencePath = resolve(required("PRODUCTION_EVIDENCE_PATH"));
  const context = workflowContext();
  requireOwnerActor(context);
  const runId = required("PRODUCTION_EVIDENCE_RUN_ID");
  if (runId === context.runId) throw new Error("EVIDENCE_RUN_REPLAY_INVALID");
  const stats = await lstat(evidencePath).catch(() => null);
  if (!stats?.isFile() || stats.size > 64 * 1_024) {
    throw new Error("OPERATION_EVIDENCE_FILE_INVALID");
  }
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const result = validateProductionOperationEvidence({
    evidence,
    expected: {
      repository: context.repository,
      runId,
      commitSha: context.commitSha,
      treeSha: git("rev-parse", "HEAD^{tree}"),
      operation: required("PRODUCTION_APPROVAL_OPERATION"),
      repositoryOwner: context.repositoryOwner,
      verifyingActor: context.actor,
    },
    runMetadata: await githubRun(context.repository, runId),
  });
  console.log(JSON.stringify({
    event: "production_predecessor_evidence_verified",
    operation: result.operation,
    runId: result.runId,
  }));
}

async function createReceipt() {
  const outputPath = resolve(required("PRODUCTION_APPROVAL_RECEIPT_PATH"));
  const context = workflowContext();
  requireOwnerActor(context);
  const { treeSha, stagingTreeSha } = gitTrees();
  const receipt = createProductionApprovalReceipt({
    repository: context.repository,
    planRunId: context.runId,
    commitSha: context.commitSha,
    treeSha,
    stagingTreeSha,
    operation: required("PRODUCTION_APPROVAL_OPERATION"),
    parameters: parameters(),
    requestedBy: context.actor,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(JSON.stringify({
    event: "production_plan_receipt_created",
    operation: receipt.operation,
    planRunId: receipt.planRunId,
    expiresAt: receipt.expiresAt,
  }));
}

async function verifyReceipt() {
  const receiptPath = resolve(required("PRODUCTION_APPROVAL_RECEIPT_PATH"));
  const context = workflowContext();
  requireOwnerActor(context);
  const planRunId = required("PRODUCTION_APPROVAL_PLAN_RUN_ID");
  if (planRunId === context.runId) throw new Error("PLAN_RUN_REPLAY_INVALID");
  const stats = await lstat(receiptPath).catch(() => null);
  if (!stats?.isFile() || stats.size > 64 * 1_024) {
    throw new Error("PLAN_RECEIPT_FILE_INVALID");
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const { treeSha, stagingTreeSha } = gitTrees();
  const runMetadata = await githubRun(context.repository, planRunId);
  const result = validateProductionApprovalReceipt({
    receipt,
    expected: {
      repository: context.repository,
      planRunId,
      commitSha: context.commitSha,
      treeSha,
      stagingTreeSha,
      operation: required("PRODUCTION_APPROVAL_OPERATION"),
      parameters: parameters(),
      repositoryOwner: context.repositoryOwner,
      applyActor: context.actor,
    },
    runMetadata,
  });
  console.log(JSON.stringify({
    event: "production_plan_approved_for_apply",
    operation: result.operation,
    planRunId: result.planRunId,
    expiresAt: result.expiresAt,
  }));
}

function workflowContext() {
  return {
    repository: required("GITHUB_REPOSITORY"),
    repositoryOwner: required("GITHUB_REPOSITORY_OWNER"),
    runId: required("GITHUB_RUN_ID"),
    commitSha: required("GITHUB_SHA"),
    actor: required("GITHUB_ACTOR"),
    ref: required("GITHUB_REF"),
  };
}

function requireOwnerActor(context) {
  if (context.ref !== "refs/heads/main") throw new Error("PRODUCTION_REF_NOT_MAIN");
  if (context.actor !== context.repositoryOwner) {
    throw new Error("PRODUCTION_ACTOR_NOT_REPOSITORY_OWNER");
  }
}

function gitTrees() {
  return {
    treeSha: git("rev-parse", "HEAD^{tree}"),
    stagingTreeSha: git("rev-parse", "origin/staging^{tree}"),
  };
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function parameters() {
  const raw = process.env.PRODUCTION_APPROVAL_PARAMETERS_JSON?.trim() || "{}";
  if (Buffer.byteLength(raw, "utf8") > 4_096) {
    throw new Error("PLAN_PARAMETERS_TOO_LARGE");
  }
  return JSON.parse(raw);
}

async function githubRun(repository, runId) {
  if (!/^[1-9][0-9]{0,19}$/u.test(runId)) throw new Error("PLAN_RUN_ID_INVALID");
  const apiUrl = required("GITHUB_API_URL");
  const token = required("GITHUB_TOKEN");
  const response = await fetch(
    `${apiUrl}/repos/${repository}/actions/runs/${runId}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error("PLAN_RUN_LOOKUP_FAILED");
  return response.json();
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_]+$/u.test(message) ? message : "PRODUCTION_APPROVAL_FAILED";
}
