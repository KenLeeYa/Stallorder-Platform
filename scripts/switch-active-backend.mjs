import {
  FailoverOperationError,
  buildRuntimeCutover,
  createFailoverClients,
  disconnectFailoverClients,
  hasOption,
  inspectDrReadiness,
  inspectFailbackReadiness,
  nextPromotionEpoch,
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
let clients;

try {
  const target = requireTarget();
  if (!apply) {
    console.log(safeJson({
      mode: "dry-run",
      action: target === "DR" ? "PROMOTE_DR" : "PROMOTE_PRIMARY",
      target,
      writes: true,
      steps: target === "DR"
        ? [
            "verify Primary is sealed and DR readiness remains green",
            "increment promotion_epoch",
            "promote DR to ACTIVE_WRITER",
            "record DR_ACTIVE evidence",
            "apply the listed Vercel/Supabase runtime binding changes",
            "deploy the already validated release and run validate-active-backend",
          ]
        : [
            "verify DR is sealed and failback reconciliation evidence is green",
            "increment promotion_epoch",
            "promote Primary to ACTIVE_WRITER",
            "demote DR to READ_ONLY_STANDBY",
            "record PRIMARY_ACTIVE evidence",
            "restore Primary runtime bindings and validate",
          ],
      applyRequirements: [
        "--apply",
        "--reason with 10 to 1000 characters",
        "PRODUCTION_ENVIRONMENT_APPROVED=true",
        `DR_CHANGE_CONFIRMATION=${target === "DR" ? "PROMOTE_DR" : "PROMOTE_PRIMARY"}`,
        "requester and approver Profile IDs",
      ],
      rollback: target === "DR"
        ? "Use the documented failback sequence; never immediately enable Primary as a second writer."
        : "Freeze Primary and use the documented failover sequence; never reactivate DR directly.",
    }));
    process.exit(0);
  }

  const action = target === "DR" ? "PROMOTE_DR" : "PROMOTE_PRIMARY";
  requireApplyApproval(action);
  const reason = requireReason();
  const actors = requireActors();
  clients = createFailoverClients();

  if (target === "DR") {
    const readiness = await inspectDrReadiness(clients, { requirePrimaryFrozen: true });
    if (!readiness.ready) {
      console.error(safeJson({
        event: "dr_promotion_blocked",
        ...sanitizedReadinessEvidence(readiness),
      }));
      process.exitCode = 2;
    } else {
      const epoch = nextPromotionEpoch(
        readiness.primaryRuntime.promotionEpoch,
        readiness.drRuntime.promotionEpoch,
      );
      await clients.dr.$transaction(async (transaction) => {
        await transitionRuntime(transaction, {
          expectedBackendCode: "DR",
          expectedPromotionEpoch: readiness.drRuntime.promotionEpoch,
          targetBackendCode: "DR",
          targetBackendRole: "ACTIVE_WRITER",
          targetPromotionEpoch: epoch,
          reason,
          actorProfileId: actors.approvedBy,
        });
        await recordFailoverEvent(transaction, {
          state: "DR_ACTIVE",
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
        event: "dr_promoted",
        runtimeState: "ACTIVE_WRITER",
        ...buildRuntimeCutover("DR", epoch),
        nextAction: "Update protected runtime bindings, deploy the validated release, then validate DR.",
      }));
    }
  } else {
    const readiness = await inspectFailbackReadiness(clients, { requireDrFrozen: true });
    if (!readiness.ready) {
      console.error(safeJson({
        event: "primary_promotion_blocked",
        ...sanitizedReadinessEvidence(readiness),
      }));
      process.exitCode = 2;
    } else {
      if (!["SEALED", "READ_ONLY_STANDBY"].includes(readiness.primaryRuntime.backendRole)) {
        throw new FailoverOperationError("PRIMARY_NOT_FENCED");
      }
      const epoch = nextPromotionEpoch(
        readiness.primaryRuntime.promotionEpoch,
        readiness.drRuntime.promotionEpoch,
      );
      await clients.primary.$transaction(async (transaction) => {
        await transitionRuntime(transaction, {
          expectedBackendCode: "PRIMARY",
          expectedPromotionEpoch: readiness.primaryRuntime.promotionEpoch,
          targetBackendCode: "PRIMARY",
          targetBackendRole: "ACTIVE_WRITER",
          targetPromotionEpoch: epoch,
          reason,
          actorProfileId: actors.approvedBy,
        });
        await recordFailoverEvent(transaction, {
          state: "PRIMARY_ACTIVE",
          sourceBackendCode: "DR",
          targetBackendCode: "PRIMARY",
          healthEvidence: sanitizedReadinessEvidence(readiness),
          requestedByProfileId: actors.requestedBy,
          approvedByProfileId: actors.approvedBy,
          reason,
        });
      });
      await transitionRuntime(clients.dr, {
        expectedBackendCode: "DR",
        expectedPromotionEpoch: readiness.drRuntime.promotionEpoch,
        targetBackendCode: "DR",
        targetBackendRole: "READ_ONLY_STANDBY",
        targetPromotionEpoch: epoch,
        reason,
        actorProfileId: actors.approvedBy,
      });
      console.log(safeJson({
        event: "primary_promoted",
        runtimeState: "ACTIVE_WRITER",
        drState: "READ_ONLY_STANDBY",
        ...buildRuntimeCutover("PRIMARY", epoch),
        nextAction: "Restore protected Primary bindings, deploy the validated release, then validate Primary.",
      }));
    }
  }
} catch (error) {
  console.error(safeJson({
    event: "active_backend_switch_failed",
    reason: safeFailure(error),
  }));
  process.exitCode = 1;
} finally {
  if (clients) await disconnectFailoverClients(clients);
}
