import { describe, expect, it, vi } from "vitest";
import { createEdgePerformanceTiming, finalizeEdgeResponse } from "./performance";

describe("Edge Function performance timing", () => {
  it("records database timing without request data", async () => {
    const times = [0, 5, 20, 30];
    const logger = vi.fn();
    const timing = createEdgePerformanceTiming({
      route: "/functions/v1/example",
      requestId: "request-id",
      now: () => times.shift() ?? 30,
      logger,
    });

    await timing.measure("dbMs", async () => true);
    const response = finalizeEdgeResponse(new Response(null, { status: 200 }), timing);

    expect(response.headers.get("server-timing")).toBe(
      "total;dur=30, edge-function;dur=30, db;dur=15",
    );
    expect(logger).toHaveBeenCalledWith({
      level: "info",
      event: "request_completed",
      route: "/functions/v1/example",
      requestId: "request-id",
      status: 200,
      totalMs: 30,
      edgeFunctionMs: 30,
      dbMs: 15,
    });
  });
});
