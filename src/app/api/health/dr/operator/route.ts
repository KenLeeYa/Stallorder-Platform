import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { createRequestId } from "@/lib/security";
import { getDrOperatorReadiness } from "@/server/resilience/dr-operator-readiness";

const responseHeaders = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

export async function GET() {
  if (process.env.DR_OPERATOR_PROBE_ENABLED !== "true") {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: responseHeaders },
    );
  }

  const requestId = createRequestId();
  try {
    const readiness = await getDrOperatorReadiness();
    if (readiness.status !== "READY") {
      logEvent("warn", "DR_OPERATOR_READINESS_BLOCKED", {
        requestId,
        blockedChecks: Object.entries(readiness.checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name)
          .join(","),
      });
    }
    return NextResponse.json(readiness, {
      status: readiness.status === "READY" ? 200 : 503,
      headers: { ...responseHeaders, "x-request-id": requestId },
    });
  } catch {
    logEvent("error", "DR_OPERATOR_READINESS_FAILED", { requestId });
    return NextResponse.json(
      { status: "BLOCKED", reasonCode: "READINESS_PROBE_FAILED" },
      {
        status: 503,
        headers: { ...responseHeaders, "x-request-id": requestId },
      },
    );
  }
}
