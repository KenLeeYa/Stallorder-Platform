import { appendFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const primary = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DIRECT_URL") } },
});

try {
  const email = required("FAILOVER_ACTOR_EMAIL").toLowerCase();
  const output = required("GITHUB_ENV");
  const rows = await primary.$queryRawUnsafe(
    `select id
     from public.profiles
     where lower(email) = $1
       and is_active
       and platform_role = 'PLATFORM_ADMIN'
     limit 1`,
    email,
  );
  if (!rows[0]?.id) throw new Error("FAILOVER_ACTOR_NOT_AUTHORIZED");
  await appendFile(
    output,
    `FAILOVER_REQUESTED_BY_PROFILE_ID=${rows[0].id}\n`
      + `FAILOVER_APPROVED_BY_PROFILE_ID=${rows[0].id}\n`,
    { encoding: "utf8" },
  );
  console.log(JSON.stringify({
    event: "failover_actor_exported",
    profileId: rows[0].id,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "failover_actor_export_failed",
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
