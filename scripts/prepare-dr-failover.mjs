import {
  FailoverOperationError,
  advanceTargetSequences,
  createFailoverClients,
  disconnectFailoverClients,
  hasOption,
  inspectDrReadiness,
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
  const target = requireTarget(process.argv.slice(2), ["DR"]);
  if (apply && rollback) throw new FailoverOperationError("APPLY_AND_ROLLBACK_CONFLICT");
  if (!apply && !rollback) {
    console.log(safeJson({
      mode: "dry-run",
      action: "PREPARE_DR_FAILOVER",
      target,
      writes: true,
      steps: [
        "verify readiness evidence without modifying either backend",
        "activate the Primary fence and configure the DR project as READ_ONLY_STANDBY",
        "advance DR sequences above replicated maxima with a reserve",
        "recheck readiness",
        "seal Primary writes",
        "record PRIMARY_WRITE_FREEZE evidence",
      ],
      applyRequirements: [
        "--apply",
        "--reason with 10 to 1000 characters",
        "PRODUCTION_ENVIRONMENT_APPROVED=true",
        "DR_CHANGE_CONFIRMATION=PREPARE_DR_FAILOVER",
        "requester and approver Profile IDs",
      ],
      rollback: "Run with --rollback and DR_CHANGE_CONFIRMATION=ROLLBACK_PRIMARY_WRITE_FREEZE before DR promotion.",
    }));
    process.exit(0);
  }

  const action = rollback ? "ROLLBACK_PRIMARY_WRITE_FREEZE" : "PREPARE_DR_FAILOVER";
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
      primaryState.backendCode !== "PRIMARY"
      || primaryState.backendRole !== "SEALED"
      || drState.backendCode !== "DR"
      || drState.backendRole === "ACTIVE_WRITER"
    ) {
      throw new FailoverOperationError("PRIMARY_FREEZE_ROLLBACK_NOT_SAFE");
    }
    await clients.primary.$transaction(async (transaction) => {
      await transitionRuntime(transaction, {
        expectedBackendCode: "PRIMARY",
        expectedPromotionEpoch: primaryState.promotionEpoch,
        targetBackendCode: "PRIMARY",
        targetBackendRole: "ACTIVE_WRITER",
        targetPromotionEpoch: primaryState.promotionEpoch,
        reason,
        actorProfileId: actors.approvedBy,
      });
      await recordFailoverEvent(transaction, {
        state: "PRIMARY_ACTIVE",
        sourceBackendCode: "PRIMARY",
        targetBackendCode: "PRIMARY",
        healthEvidence: { rollbackBeforeDrPromotion: true },
        requestedByProfileId: actors.requestedBy,
        approvedByProfileId: actors.approvedBy,
        reason,
      });
    });
    console.log(safeJson({
      event: "primary_write_freeze_rolled_back",
      target: "PRIMARY",
      promotionEpoch: primaryState.promotionEpoch,
    }));
    process.exit(0);
  }

  const preflight = await inspectDrReadiness(clients, {
    requireRuntimeIdentity: false,
    requireSequenceSafety: false,
  });
  if (!preflight.ready) {
    console.error(safeJson({
      event: "dr_failover_prepare_blocked",
      ...sanitizedReadinessEvidence(preflight),
    }));
    process.exitCode = 2;
  } else {
    const [primaryBefore, drBefore] = await Promise.all([
      readRuntimeState(clients.primary),
      readRuntimeState(clients.dr),
    ]);
    if (primaryBefore.backendCode !== "PRIMARY" || primaryBefore.backendRole !== "ACTIVE_WRITER") {
      throw new FailoverOperationError("PRIMARY_RUNTIME_NOT_ACTIVE");
    }
    if (
      drBefore.backendCode === "DR"
      && drBefore.promotionEpoch !== primaryBefore.promotionEpoch
    ) {
      throw new FailoverOperationError("DR_PROMOTION_EPOCH_NOT_ALIGNED");
    }

    await transitionRuntime(clients.dr, {
      expectedBackendCode: drBefore.backendCode,
      expectedPromotionEpoch: drBefore.promotionEpoch,
      targetBackendCode: "DR",
      targetBackendRole: "READ_ONLY_STANDBY",
      targetPromotionEpoch: primaryBefore.promotionEpoch,
      reason,
      actorProfileId: actors.approvedBy,
    });
    await transitionRuntime(clients.primary, {
      expectedBackendCode: "PRIMARY",
      expectedPromotionEpoch: primaryBefore.promotionEpoch,
      targetBackendCode: "PRIMARY",
      targetBackendRole: "ACTIVE_WRITER",
      targetPromotionEpoch: primaryBefore.promotionEpoch,
      reason,
      actorProfileId: actors.approvedBy,
    });
    const sequenceResult = await advanceTargetSequences(clients.primary, clients.dr);
    const readiness = await inspectDrReadiness(clients);
    if (!readiness.ready) {
      console.error(safeJson({
        event: "dr_failover_prepare_blocked_after_fencing",
        ...sanitizedReadinessEvidence(readiness),
      }));
      process.exitCode = 2;
    } else {
      await clients.primary.$transaction(async (transaction) => {
        await transitionRuntime(transaction, {
          expectedBackendCode: "PRIMARY",
          expectedPromotionEpoch: readiness.primaryRuntime.promotionEpoch,
          targetBackendCode: "PRIMARY",
          targetBackendRole: "SEALED",
          targetPromotionEpoch: readiness.primaryRuntime.promotionEpoch,
          reason,
          actorProfileId: actors.approvedBy,
        });
        await recordFailoverEvent(transaction, {
          state: "PRIMARY_WRITE_FREEZE",
          sourceBackendCode: "PRIMARY",
          targetBackendCode: "DR",
          healthEvidence: sanitizedReadinessEvidence(readiness),
          replicationLagSeconds: readiness.replication?.lagSeconds ?? null,
          lastKnownLsn: readiness.replication?.replayLsn ?? null,
          requestedByProfileId: actors.requestedBy,
          approvedByProfileId: actors.approvedBy,
          reason,
          rpoEstimateSeconds: readiness.replication?.lagSeconds === null
            || readiness.replication?.lagSeconds === undefined
            ? null
            : Math.ceil(readiness.replication.lagSeconds),
        });
      });
      console.log(safeJson({
        event: "dr_failover_prepared",
        target,
        primaryState: "SEALED",
        drState: "READ_ONLY_STANDBY",
        promotionEpoch: readiness.primaryRuntime.promotionEpoch,
        sequences: sequenceResult,
        nextAction: "Run switch-active-backend.mjs --target DR after approval.",
      }));
    }
  }
} catch (error) {
  console.error(safeJson({
    event: "dr_failover_prepare_failed",
    reason: safeFailure(error),
  }));
  process.exitCode = 1;
} finally {
  if (clients) await disconnectFailoverClients(clients);
}
