import { PrismaClient } from "@prisma/client";

const subscriptionName = "stallorder_primary_to_dr";
const action = process.argv.includes("--disable")
  ? "disable"
  : process.argv.includes("--enable")
    ? "enable"
    : null;
if (!action) {
  console.error(JSON.stringify({
    event: "dr_subscription_control_failed",
    reason: "ACTION_REQUIRED",
  }));
  process.exit(1);
}

const dr = new PrismaClient({
  datasources: { db: { url: requiredPostgresUrl("DR_DIRECT_URL") } },
});

try {
  if (process.env.PRODUCTION_ENVIRONMENT_APPROVED !== "true") {
    throw new Error("PRODUCTION_ENVIRONMENT_NOT_APPROVED");
  }
  const expectedConfirmation = action === "disable"
    ? "DISABLE_DR_SUBSCRIPTION"
    : "ENABLE_DR_SUBSCRIPTION";
  if (process.env.DR_CHANGE_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`CONFIRMATION_REQUIRED_${expectedConfirmation}`);
  }

  const rows = await dr.$queryRawUnsafe(
    `select subenabled
     from pg_catalog.pg_subscription
     where subname = $1
     limit 1`,
    subscriptionName,
  );
  if (!rows[0]) throw new Error("DR_SUBSCRIPTION_NOT_FOUND");

  await dr.$executeRawUnsafe(
    `alter subscription "${subscriptionName}" ${action}`,
  );
  console.log(JSON.stringify({
    event: `dr_subscription_${action}d`,
    subscriptionName,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "dr_subscription_control_failed",
    action,
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await dr.$disconnect();
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
