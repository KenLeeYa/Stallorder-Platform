import {
  FailoverOperationError,
  createFailoverClients,
  disconnectFailoverClients,
  hasOption,
  readRuntimeState,
  requireApplyApproval,
  requireExpectedEpoch,
  requireTarget,
  safeFailure,
  safeJson,
} from "./lib/dr-failover-operations.mjs";

const apply = hasOption("--apply");
let clients;

async function fetchJson(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new FailoverOperationError("ACTIVE_BACKEND_HTTP_CHECK_FAILED");
  return response.json();
}

try {
  const target = requireTarget();
  const baseUrlValue = process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : null;
  if (!apply) {
    console.log(safeJson({
      mode: "dry-run",
      action: `VALIDATE_${target}_ACTIVE`,
      target,
      writes: false,
      checks: [
        "target runtime is ACTIVE_WRITER and fenced",
        "promotion epoch equals --expected-epoch",
        "assert_backend_writable accepts the expected epoch",
        "availability endpoint reports the same target and epoch when --base-url is supplied",
        "application health endpoint is available when --base-url is supplied",
      ],
      rollback: "No rollback is required because this operation is read-only.",
    }));
    process.exit(0);
  }

  requireApplyApproval(`VALIDATE_${target}_ACTIVE`);
  const expectedEpoch = requireExpectedEpoch();
  clients = createFailoverClients();
  const database = target === "DR" ? clients.dr : clients.primary;
  const runtime = await readRuntimeState(database);
  if (
    runtime.backendCode !== target
    || runtime.backendRole !== "ACTIVE_WRITER"
    || !runtime.writesEnabled
    || !runtime.enforcementEnabled
    || runtime.promotionEpoch !== expectedEpoch
  ) {
    throw new FailoverOperationError("ACTIVE_BACKEND_RUNTIME_MISMATCH");
  }
  await database.$queryRawUnsafe(
    "select app_private.assert_backend_writable($1::bigint)",
    BigInt(expectedEpoch),
  );

  let application = null;
  if (baseUrlValue) {
    const baseUrl = new URL(baseUrlValue);
    if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "127.0.0.1" && baseUrl.hostname !== "localhost") {
      throw new FailoverOperationError("ACTIVE_BACKEND_BASE_URL_INVALID");
    }
    const [availability, health] = await Promise.all([
      fetchJson(baseUrl, "/api/availability/config"),
      fetchJson(baseUrl, "/api/health"),
    ]);
    if (
      availability.activeBackend !== target
      || availability.promotionEpoch !== expectedEpoch
    ) {
      throw new FailoverOperationError("ACTIVE_BACKEND_APPLICATION_MISMATCH");
    }
    application = {
      availabilityStatus: availability.mode,
      healthStatus: health.status,
    };
  }

  console.log(safeJson({
    event: "active_backend_validated",
    target,
    promotionEpoch: expectedEpoch,
    application,
  }));
} catch (error) {
  console.error(safeJson({
    event: "active_backend_validation_failed",
    reason: safeFailure(error),
  }));
  process.exitCode = 1;
} finally {
  if (clients) await disconnectFailoverClients(clients);
}
