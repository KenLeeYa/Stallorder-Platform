import {
  createFailoverClients,
  disconnectFailoverClients,
  hasOption,
  inspectDrReadiness,
  requireApplyApproval,
  requireTarget,
  safeFailure,
  safeJson,
  sanitizedReadinessEvidence,
} from "./lib/dr-failover-operations.mjs";

const apply = hasOption("--apply");
let clients;

try {
  const target = requireTarget(process.argv.slice(2), ["DR"]);
  if (!apply) {
    console.log(safeJson({
      mode: "dry-run",
      action: "CHECK_DR_READINESS",
      target,
      writes: false,
      checks: [
        "Primary and DR connectivity",
        "migration history equality",
        "fenced runtime identities",
        "replication status, freshness and lag",
        "Storage mirror health",
        "sequence safety reserve",
        "Auth, Edge Functions, Turnstile and payment callback evidence",
        "no active migration confirmation",
      ],
      applyRequirements: [
        "--apply",
        "PRODUCTION_ENVIRONMENT_APPROVED=true",
        "DR_CHANGE_CONFIRMATION=CHECK_DR_READINESS",
        "DIRECT_URL and DR_DIRECT_URL",
      ],
      rollback: "No rollback is required because this operation is read-only.",
    }));
    process.exit(0);
  }

  requireApplyApproval("CHECK_DR_READINESS");
  clients = createFailoverClients();
  const readiness = await inspectDrReadiness(clients);
  console.log(safeJson({
    event: "dr_readiness_checked",
    target,
    ...sanitizedReadinessEvidence(readiness),
  }));
  if (!readiness.ready) process.exitCode = 2;
} catch (error) {
  console.error(safeJson({
    event: "dr_readiness_check_failed",
    reason: safeFailure(error),
  }));
  process.exitCode = 1;
} finally {
  if (clients) await disconnectFailoverClients(clients);
}
