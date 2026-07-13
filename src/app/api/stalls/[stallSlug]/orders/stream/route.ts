import { logEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();
const pollIntervalMs = 1_000;
const heartbeatIntervalMs = 15_000;
const streamLifetimeMs = 50_000;

type RouteContext = { params: Promise<{ stallSlug: string }> };

async function getLatestOrderEventId(stallId: string) {
  const event = await prisma.orderEvent.findFirst({
    where: { stallId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return event?.id ?? null;
}

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;

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
          // The client may already have closed the stream.
        }
      };

      const poll = async () => {
        try {
          const currentEventId = await getLatestOrderEventId(authorization.stall.id);
          if (latestEventId === undefined) {
            latestEventId = currentEventId;
            send("event: ready\ndata: {}\n\n");
          } else if (currentEventId !== latestEventId) {
            latestEventId = currentEventId;
            send("event: orders\ndata: {}\n\n");
          }
        } catch (error) {
          logEvent("error", "ORDER_STREAM_POLL_FAILED", {
            requestId: authorization.requestId,
            stallId: authorization.stall.id,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
          close();
          return;
        }

        if (!closed) pollTimer = setTimeout(() => void poll(), pollIntervalMs);
      };

      const heartbeatTimer = setInterval(() => send(": heartbeat\n\n"), heartbeatIntervalMs);
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
      "x-request-id": authorization.requestId,
    },
  });
}
