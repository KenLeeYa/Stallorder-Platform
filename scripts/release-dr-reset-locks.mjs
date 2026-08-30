import { PrismaClient } from "@prisma/client";
import {
  DrResetLockReleaseError,
  releaseDrResetLocks,
} from "./lib/dr-reset-lock-release.mjs";

let database;

try {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new DrResetLockReleaseError("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  if (process.env.DR_CHANGE_CONFIRMATION?.trim() !== "RELEASE_DR_RESET_LOCKS") {
    throw new DrResetLockReleaseError(
      "DR_RESET_LOCK_RELEASE_CONFIRMATION_INVALID",
    );
  }
  database = new PrismaClient({
    datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
  });
  const result = await releaseDrResetLocks(database);
  console.log(JSON.stringify({
    event: "dr_reset_locks_released",
    target: "DR",
    ...result,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_reset_lock_release_failed",
    reason: error instanceof DrResetLockReleaseError
      ? error.code
      : "DR_RESET_LOCK_RELEASE_FAILED",
  }));
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}

function requiredPostgresUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new DrResetLockReleaseError(`${name}_MISSING`);
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new DrResetLockReleaseError(`${name}_INVALID`);
  }
  return value;
}
