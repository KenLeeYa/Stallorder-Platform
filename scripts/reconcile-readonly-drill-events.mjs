import { PrismaClient } from "@prisma/client";
import { readRuntimeState } from "./lib/dr-failover-operations.mjs";

const copy = process.argv.includes("--copy");
const deleteDrLocal = process.argv.includes("--delete-dr-local");
if (copy === deleteDrLocal) {
  console.error(JSON.stringify({
    event: "dr_event_reconciliation_failed",
    reason: "EXACTLY_ONE_ACTION_REQUIRED",
  }));
  process.exit(1);
}

const primary = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
});
const dr = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
});

try {
  requireApproval(copy ? "COPY_DRILL_EVENTS_TO_PRIMARY" : "DELETE_DR_LOCAL_EVENT_COPIES");
  const drillId = required("DR_DRILL_ID");
  const reasonMarker = `[drill:${drillId}]`;
  const events = await dr.$queryRawUnsafe(
    `select *
     from public.backend_failover_events
     where state in ('DR_ACTIVE', 'DR_WRITE_FREEZE')
       and position($1 in reason) > 0
     order by created_at`,
    reasonMarker,
  );
  if (events.length !== 2) throw new Error("EXPECTED_DRILL_EVENTS_NOT_FOUND");

  if (copy) {
    for (const event of events) {
      await primary.$executeRawUnsafe(
        `insert into public.backend_failover_events (
           id,
           state,
           source_backend_code,
           target_backend_code,
           health_evidence,
           replication_lag_seconds,
           last_known_lsn,
           requested_by_profile_id,
           approved_by_profile_id,
           reason,
           rpo_estimate_seconds,
           split_brain_acknowledged,
           assessment_started_at,
           transition_completed_at,
           created_at
         )
         values (
           $1::uuid,
           $2::text,
           $3::text,
           $4::text,
           $5::jsonb,
           $6::numeric,
           $7::text,
           $8::uuid,
           $9::uuid,
           $10::text,
           $11::integer,
           $12::boolean,
           $13::timestamptz,
           $14::timestamptz,
           $15::timestamptz
         )
         on conflict (id) do nothing`,
        event.id,
        event.state,
        event.source_backend_code,
        event.target_backend_code,
        JSON.stringify(event.health_evidence ?? {}),
        event.replication_lag_seconds,
        event.last_known_lsn,
        event.requested_by_profile_id,
        event.approved_by_profile_id,
        event.reason,
        event.rpo_estimate_seconds,
        event.split_brain_acknowledged,
        event.assessment_started_at,
        event.transition_completed_at,
        event.created_at,
      );
    }
  } else {
    const [primaryRuntime, drRuntime, primaryCopies] = await Promise.all([
      readRuntimeState(primary),
      readRuntimeState(dr),
      primary.$queryRawUnsafe(
        `select count(*)::integer as count
         from public.backend_failover_events
         where id = any($1::uuid[])`,
        events.map((event) => event.id),
      ),
    ]);
    if (
      primaryRuntime.backendCode !== "PRIMARY"
      || primaryRuntime.backendRole !== "ACTIVE_WRITER"
      || drRuntime.backendCode !== "DR"
      || drRuntime.backendRole !== "READ_ONLY_STANDBY"
      || primaryCopies[0]?.count !== events.length
    ) {
      throw new Error("EVENT_DELETE_SAFETY_CHECK_FAILED");
    }
    await dr.$executeRawUnsafe(
      "delete from public.backend_failover_events where id = any($1::uuid[])",
      events.map((event) => event.id),
    );
  }

  console.log(JSON.stringify({
    event: copy
      ? "drill_events_copied_to_primary"
      : "dr_local_event_copies_deleted",
    drillId,
    eventCount: events.length,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_event_reconciliation_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([primary.$disconnect(), dr.$disconnect()]);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function requiredPostgresUrl(name) {
  const value = required(name);
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function requireApproval(expected) {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new Error("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  if (process.env.DR_CHANGE_CONFIRMATION !== expected) {
    throw new Error(`CONFIRMATION_REQUIRED_${expected}`);
  }
}
