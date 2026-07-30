import { PrismaClient } from "@prisma/client";

const enabled = process.argv.includes("--enable")
  ? true
  : process.argv.includes("--disable")
    ? false
    : null;
if (enabled === null) {
  console.error(JSON.stringify({
    event: "dr_failover_flag_change_failed",
    reason: "ACTION_REQUIRED",
  }));
  process.exit(1);
}

const primary = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
});

try {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new Error("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  const expected = enabled ? "ENABLE_DR_FAILOVER_FLAG" : "DISABLE_DR_FAILOVER_FLAG";
  if (process.env.DR_CHANGE_CONFIRMATION !== expected) {
    throw new Error(`CONFIRMATION_REQUIRED_${expected}`);
  }
  const actorEmail = required("FAILOVER_ACTOR_EMAIL").toLowerCase();
  const actors = await primary.$queryRawUnsafe(
    `select id
     from public.profiles
     where lower(email) = $1
       and is_active
       and platform_role = 'PLATFORM_ADMIN'
     limit 1`,
    actorEmail,
  );
  if (!actors[0]?.id) throw new Error("FAILOVER_ACTOR_NOT_AUTHORIZED");
  const count = await primary.$executeRawUnsafe(
    `update public.resilience_feature_flag_overrides override
     set
       enabled = $1::boolean,
       expires_at = case when $1::boolean then now() + interval '12 hours' else now() end,
       reason = $2::text,
       updated_by_profile_id = $3::uuid,
       updated_at = now()
     from public.resilience_feature_flags flag
     where override.flag_id = flag.id
       and flag.code = 'DR_FAILOVER_ENABLED'
       and override.scope_type = 'GLOBAL'
       and override.organization_id is null
       and override.stall_id is null
       and override.device_id is null`,
    enabled,
    enabled
      ? "Approved Production DR failover measurement window."
      : "Production DR drill completed; emergency failover gate closed.",
    actors[0].id,
  );
  if (count !== 1) throw new Error("DR_FAILOVER_OVERRIDE_NOT_FOUND");
  console.log(JSON.stringify({
    event: "dr_failover_flag_changed",
    enabled,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_failover_flag_change_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await primary.$disconnect();
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
