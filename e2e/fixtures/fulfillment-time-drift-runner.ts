import { createHash } from "node:crypto";

async function main() {
  for (const name of ["DATABASE_URL", "SUPABASE_FUNCTIONS_URL"]) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env[name] ?? "").hostname)) {
      throw new Error("LOCAL_DRIFT_TEST_ONLY");
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const { trackingToken, deviceId, version, response, origin } = JSON.parse(Buffer.concat(chunks).toString());
  process.env.ABUSE_HASH_SECRET = createHash("sha256").update(process.env.ABUSE_HASH_SECRET ?? "").digest("hex");
  process.env.APP_BASE_URL = origin;
  process.env.NEXT_PUBLIC_APP_URL = origin;
  process.env.PUBLIC_ORDER_FUNCTION_ORIGIN = origin;
  Object.assign(process.env, { NODE_ENV: "development" });
  const { POST } = await import("../../src/app/api/public/orders/[trackingToken]/fulfillment-time/route");
  const { prisma } = await import("../../src/lib/prisma");
  try {
    const result = await POST(new Request(origin + "/api/public/orders/" + trackingToken + "/fulfillment-time", {
      method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify({ deviceId, version, response }),
    }), { params: Promise.resolve({ trackingToken }) });
    console.log("__RESULT__" + JSON.stringify({ status: result.status, body: await result.json() }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("LOCAL_DRIFT_TEST_FAILED"); process.exitCode = 1; });
