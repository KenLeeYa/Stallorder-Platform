import "server-only";

import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp } from "@/lib/security";
import { entitlementService } from "@/server/billing/entitlement-service";
import type { PublicPickupDisplay } from "@/lib/pickup-display-contract";

const encoder = new TextEncoder();
const streamPollIntervalMs = 2_000;
const streamHeartbeatIntervalMs = 15_000;
const streamLifetimeMs = 50_000;

type DisplayAccess = { organizationId: string; stallId: string };

export async function publicPickupDisplayResponse(
  request: Request,
  displayKeyHash: string,
  route: string,
  loader: () => Promise<PublicPickupDisplay | null>,
) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route, requestId });
  const limited = await timing.measureDb(() => enforcePublicDisplayRateLimit(
    request,
    displayKeyHash,
    "read",
    requestId,
  ), 2);
  if (limited) return finalizePerformanceResponse(limited, timing);

  const display = await timing.measureDb(loader, 3);
  if (!display) {
    return finalizePerformanceResponse(NextResponse.json(
      { error: "目前無法使用此取餐顯示。" },
      { status: 404, headers: noStoreHeaders(requestId) },
    ), timing);
  }

  return finalizePerformanceResponse(NextResponse.json(
    { display },
    { headers: noStoreHeaders(requestId) },
  ), timing);
}

export async function publicPickupDisplayStream(
  request: Request,
  displayKeyHash: string,
  accessLoader: () => Promise<DisplayAccess | null>,
) {
  const requestId = createRequestId();
  const limited = await enforcePublicDisplayRateLimit(
    request,
    displayKeyHash,
    "stream",
    requestId,
  );
  if (limited) return limited;

  const access = await accessLoader();
  if (!access) {
    return NextResponse.json(
      { error: "目前無法使用此取餐顯示。" },
      { status: 404, headers: noStoreHeaders(requestId) },
    );
  }
  try {
    await entitlementService.assertFeatureEnabled(access.organizationId, "CDS");
  } catch {
    return NextResponse.json(
      { error: "目前無法使用此取餐顯示。" },
      { status: 404, headers: noStoreHeaders(requestId) },
    );
  }

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let latestEventId: string | null | undefined;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;

      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        clearInterval(heartbeatTimer);
        clearTimeout(lifetimeTimer);
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };
      const poll = async () => {
        try {
          const latestEvent = await prisma.orderEvent.findFirst({
            where: { stallId: access.stallId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          const currentEventId = latestEvent?.id ?? null;
          if (latestEventId === undefined) {
            latestEventId = currentEventId;
            send("event: ready\ndata: {}\n\n");
          } else if (currentEventId !== latestEventId) {
            latestEventId = currentEventId;
            send("event: display\ndata: {}\n\n");
          }
        } catch (error) {
          logEvent("error", "CDS_STREAM_POLL_FAILED", {
            requestId,
            stallId: access.stallId,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
          close();
          return;
        }
        if (!closed) pollTimer = setTimeout(() => void poll(), streamPollIntervalMs);
      };

      const heartbeatTimer = setInterval(
        () => send(": heartbeat\n\n"),
        streamHeartbeatIntervalMs,
      );
      const lifetimeTimer = setTimeout(close, streamLifetimeMs);
      cleanup = close;
      request.signal.addEventListener("abort", close, { once: true });
      send("retry: 3000\n\n");
      void poll();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-store, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

async function enforcePublicDisplayRateLimit(
  request: Request,
  displayKeyHash: string,
  operation: "read" | "stream",
  requestId: string,
) {
  const ipHash = hashClientIp(request);
  const [ipLimit, displayLimit] = await Promise.all([
    checkRateLimit({
      scope: `public-display-${operation}-ip`,
      identifier: ipHash,
      limit: operation === "stream" ? 30 : 300,
      windowMs: 5 * 60_000,
    }),
    checkRateLimit({
      scope: `public-display-${operation}-display`,
      identifier: displayKeyHash,
      limit: operation === "stream" ? 1_000 : 5_000,
      windowMs: 5 * 60_000,
    }),
  ]);
  if (ipLimit.allowed && displayLimit.allowed) return null;
  const retryAfterSeconds = Math.max(
    ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
    displayLimit.allowed ? 0 : displayLimit.retryAfterSeconds,
  );
  return NextResponse.json(
    { error: "請求過於頻繁，請稍後再試。" },
    {
      status: 429,
      headers: {
        ...noStoreHeaders(requestId),
        "retry-after": String(retryAfterSeconds),
      },
    },
  );
}

function noStoreHeaders(requestId: string) {
  return {
    "cache-control": "no-store, max-age=0",
    "referrer-policy": "no-referrer",
    "x-request-id": requestId,
  };
}
