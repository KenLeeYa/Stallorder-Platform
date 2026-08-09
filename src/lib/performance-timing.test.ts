import { describe, expect, it, vi } from "vitest";
import { createPerformanceTiming } from "./performance-timing";

describe("performance timing", () => {
  it("records safe structured durations and Server-Timing values", async () => {
    const times = [100, 110, 135, 160];
    const logger = vi.fn();
    const timing = createPerformanceTiming({
      route: "/api/example",
      requestId: "request-id",
      operationId: "operation-id",
      now: () => times.shift() ?? 160,
      logger,
    });

    await timing.measureDb(async () => "result");
    const finished = timing.finish({ status: 200 });

    expect(finished).toEqual({
      totalMs: 60,
      serverTiming: "total;dur=60, db-query-count;dur=1, db;dur=25",
    });
    expect(logger).toHaveBeenCalledWith("info", "request_completed", {
      route: "/api/example",
      requestId: "request-id",
      operationId: "operation-id",
      status: 200,
      totalMs: 60,
      dbQueryCount: 1,
      dbMs: 25,
    });
  });

  it("finishes only once", () => {
    const logger = vi.fn();
    let now = 0;
    const timing = createPerformanceTiming({
      route: "/api/example",
      requestId: "request-id",
      now: () => now,
      logger,
    });

    now = 10;
    const first = timing.finish({ status: 200 });
    now = 50;
    const second = timing.finish({ status: 500 });

    expect(second).toEqual(first);
    expect(logger).toHaveBeenCalledTimes(1);
  });
});
