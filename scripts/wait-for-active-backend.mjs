const target = required("EXPECTED_BACKEND").toUpperCase();
const expectedEpoch = Number.parseInt(required("EXPECTED_PROMOTION_EPOCH"), 10);
const timeoutSeconds = Number.parseInt(process.env.BACKEND_WAIT_TIMEOUT_SECONDS ?? "180", 10);
const baseUrl = new URL(required("APP_BASE_URL"));
if (!["PRIMARY", "DR"].includes(target)) throw new Error("EXPECTED_BACKEND_INVALID");
if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) {
  throw new Error("EXPECTED_PROMOTION_EPOCH_INVALID");
}
if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 600) {
  throw new Error("BACKEND_WAIT_TIMEOUT_INVALID");
}

const deadline = Date.now() + timeoutSeconds * 1000;
let lastStatus = null;
while (Date.now() < deadline) {
  try {
    const response = await fetch(new URL("/api/availability/config", baseUrl), {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const body = await response.json();
      lastStatus = {
        activeBackend: body.activeBackend,
        promotionEpoch: body.promotionEpoch,
        mode: body.mode,
      };
      const expectedMode = target === "DR" ? "NORMAL_DR" : "NORMAL_PRIMARY";
      if (
        body.activeBackend === target
        && body.promotionEpoch === expectedEpoch
        && body.mode === expectedMode
      ) {
        const readyAt = new Date();
        console.log(JSON.stringify({
          event: "active_backend_available",
          target,
          promotionEpoch: expectedEpoch,
          mode: expectedMode,
          readyAt: readyAt.toISOString(),
          readyAtMs: readyAt.getTime(),
        }));
        process.exit(0);
      }
    }
  } catch {
    // Continue until the explicit timeout so the caller gets a deterministic result.
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

console.error(JSON.stringify({
  event: "active_backend_wait_failed",
  target,
  promotionEpoch: expectedEpoch,
  lastStatus,
}));
process.exit(1);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}
