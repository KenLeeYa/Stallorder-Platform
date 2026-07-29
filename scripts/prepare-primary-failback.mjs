import {
  FailoverOperationError,
  advanceTargetSequences,
  createFailoverClients,
  disconnectFailoverClients,
  hasOption,
  inspectFailbackReadiness,
  readRuntimeState,
  recordFailoverEvent,
  requireActors,
  requireApplyApproval,
  requireReason,
  requireTarget,
  safeFailure,
  safeJson,
  sanitizedReadinessEvidence,
  transitionRuntime,
} from "./lib/dr-failover-operations.mjs";

const apply = hasOption("--apply");
const rollback = hasOption("--rollback");
let clients;

try {
  const target = requireTarget(process.argv.slice(2), ["PRIMARY"]);
  if (apply && rollback) throw new FailoverOperationError("APPLY_AND_ROLLBACK_CONFLICT");
  if (!apply && !rollback) {
    console.log(safeJson({
      mode: "dry-run",
      action: "PREPARE_PRIMARY_FAILBACK",
      target,
      writes: true,
      steps: [
        "verify both backups and DR-era reconciliation evidence",
        "verify migrations, Auth identities, Storage and business data",
        "advance Primary sequences above DR maxima with a reserve",
        "briefly seal DR writes",
        "record DR_WRITE_FREEZE evidence",
      ],
      applyRequirements: [
        "--apply",
        "--reason with 10 to 1000 characters",
        "PRODUCTION_ENVIRONMENT_APPROVED=true",
        "DR_CHANGE_CONFIRMATION=PREPARE_PRIMARY_FAILBACK",
        "requester and approver Profile IDs",
      ],
      rollback: "Run with --rollback and DR_CHANGE_CONFIRMATION=ROLLBACK_DR_WRITE_FREEZE before Primary promotion.",
    }));
    process.exit(0);
  }

  const action = rollback ? "ROLLBACK_DR_WRITE_FREEZE" : "PREPARE_PRIMARY_FAILBACK";
  requireApplyApproval(action);
  const reason = requireReason();
  const actors = requireActors();
  clients = createFailoverClients();

  if (rollback) {
    const [primaryState, drState] = await Promise.all([
      readRuntimeState(clients.primary),
      readRuntimeState(clients.dr),
    ]);
    if (
      drState.backendCode !== "DR"
      || drState.backendRole !== "SEALED"
      || primaryState.backendRole === "ACTIVE_WRITER"
    ) {
      throw new FailoverOperationError("DR_FREEZE_ROLLBACK_NOT_SAFE");
    }
    await clients.dr.$transaction(async (transaction) => {
      await transitionRuntime(transaction, {
        expectedBackendCode: "DR",
        expectedPromotionEpoch: drState.promotionEpoch,
        targetBackendCode: "DR",
        targetBackendRole: "ACTIVE_WRITER",
        targetPromotionEpoch: drState.promotionEpoch,
        reason,
        actorProfileId: actors.approvedBy,
      });
      await recordFailoverEvent(transaction, {
        state: "DR_ACTIVE",
        sourceBackendCode: "DR",
        targetBackendCode: "DR",
        healthEvidence: { rollbackBeforePrimaryPromotion: true },
        requestedByProfileId: actors.requestedBy,
        approvedByProfileId: actors.approvedBy,
        reason,
      });
    });
    console.log(safeJson({
      event: "dr_write_freeze_rolled_back",
      target: "DR",
      promotionEpoch: drState.promotionEpoch,
    }));
    process.exit(0);
  }

  const preflight = await inspectFailbackReadiness(clients, {
    requireSequenceSafety: false,
  });
  if (!preflight.ready) {
    console.error(safeJson({
      event: "primary_failback_prepare_blocked",
      ...sanitizedReadinessEvidence(preflight),
    }));
    process.exitCode = 2;
  } else {
    const sequenceResult = await advanceTargetSequences(clients.dr, clients.primary);
    const readiness = await inspectFailbackReadiness(clients);
    if (!readiness.ready) {
      console.error(safeJson({
        event: "primary_failback_prepare_blocked_after_sequence_reserve",
        ...sanitizedReadinessEvidence(readiness),
      }));
      process.exitCode = 2;
    } else {
      await clients.dr.$transaction(async (transaction) => {
        await transitionRuntime(transaction, {
          expectedBackendCode: "DR",
          expectedPromotionEpoch: readiness.drRuntime.promotionEpoch,
          targetBackendCode: "DR",
          targetBackendRole: "SEALED",
          targetPromotionEpoch: readiness.drRuntime.promotionEpoch,
          reason,
          actorProfileId: actors.approvedBy,
        });
        await recordFailoverEvent(transaction, {
          state: "DR_WRITE_FREEZE",
          sourceBackendCode: "DR",
          targetBackendCode: "PRIMARY",
          healthEvidence: sanitizedReadinessEvidence(readiness),
          requestedByProfileId: actors.requestedBy,
          approvedByProfileId: actors.approvedBy,
          reason,
        });
      });
      console.log(safeJson({
        event: "primary_failback_prepared",
        target,
        drState: "SEALED",
        primaryState: readiness.primaryRuntime.backendRole,
        promotionEpoch: readiness.drRuntime.promotionEpoch,
        sequences: sequenceResult,
        nextAction: "Run switch-active-backend.mjs --target PRIMARY after approval.",
      }));
    }
  }
} catch (error) {
  console.error(safeJson({
    event: "primary_failback_prepare_failed",
    reason: safeFailure(error),
  }));
  process.exitCode = 1;
} finally {
  if (clients) await disconnectFailoverClients(clients);
}
