import { PrismaClient } from "@prisma/client";

const target = valueAfter("--target")?.toUpperCase();
if (!["PRIMARY", "DR"].includes(target)) {
  console.error(JSON.stringify({
    event: "backend_runtime_read_failed",
    reason: "TARGET_INVALID",
  }));
  process.exit(1);
}

const database = new PrismaClient({
  datasources: {
    db: {
      url: requiredPostgresUrl(target === "PRIMARY" ? "DIRECT_URL" : "DR_DIRECT_URL"),
    },
  },
});

try {
  const rows = await database.$queryRawUnsafe(
    `select
       backend_code,
       backend_role,
       promotion_epoch::text,
       writes_enabled,
       enforcement_enabled,
       updated_at
     from public.backend_runtime_state
     where is_current
     limit 1`,
  );
  if (!rows[0]) throw new Error("BACKEND_RUNTIME_STATE_MISSING");
  console.log(JSON.stringify({
    event: "backend_runtime_read",
    target,
    backendCode: rows[0].backend_code,
    backendRole: rows[0].backend_role,
    promotionEpoch: Number.parseInt(rows[0].promotion_epoch, 10),
    writesEnabled: rows[0].writes_enabled,
    enforcementEnabled: rows[0].enforcement_enabled,
    updatedAt: new Date(rows[0].updated_at).toISOString(),
    updatedAtMs: new Date(rows[0].updated_at).getTime(),
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "backend_runtime_read_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}

function requiredPostgresUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
