export type EdgePerformanceField = "sessionMs" | "dbMs" | "turnstileMs" | "externalApiMs";

type Options = {
  route: string;
  requestId: string;
  now?: () => number;
  logger?: (record: Record<string, string | number>) => void;
};

const serverTimingNames: Record<EdgePerformanceField, string> = {
  sessionMs: "session",
  dbMs: "db",
  turnstileMs: "turnstile",
  externalApiMs: "external-api",
};

export function createEdgePerformanceTiming(options: Options) {
  const now = options.now ?? performance.now.bind(performance);
  const logger = options.logger ?? ((record) => console.info(JSON.stringify(record)));
  const startedAt = now();
  const durations: Partial<Record<EdgePerformanceField, number>> = {};
  let dbQueryCount = 0;
  let completed: { totalMs: number; serverTiming: string } | null = null;

  async function measure<T>(field: EdgePerformanceField, operation: () => Promise<T>) {
    const operationStartedAt = now();
    try {
      return await operation();
    } finally {
      durations[field] = (durations[field] ?? 0) + now() - operationStartedAt;
    }
  }

  async function measureDb<T>(operation: () => Promise<T>, queryCount = 1) {
    if (Number.isSafeInteger(queryCount) && queryCount > 0) dbQueryCount += queryCount;
    return measure("dbMs", operation);
  }

  function finish(status: number) {
    if (completed) return completed;
    const totalMs = round(now() - startedAt);
    const roundedDurations = Object.fromEntries(
      Object.entries(durations).map(([key, value]) => [key, round(value)]),
    );
    const serverTiming = [
      `total;dur=${totalMs}`,
      `edge-function;dur=${totalMs}`,
      ...(dbQueryCount > 0 ? [`db-query-count;dur=${dbQueryCount}`] : []),
      ...Object.entries(roundedDurations).map(
        ([field, duration]) => `${serverTimingNames[field as EdgePerformanceField]};dur=${duration}`,
      ),
    ].join(", ");

    logger({
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      event: "request_completed",
      route: options.route,
      requestId: options.requestId,
      status,
      totalMs,
      edgeFunctionMs: totalMs,
      ...(dbQueryCount > 0 ? { dbQueryCount } : {}),
      ...roundedDurations,
    });
    completed = { totalMs, serverTiming };
    return completed;
  }

  return { finish, measure, measureDb };
}

export function finalizeEdgeResponse(
  response: Response,
  timing: ReturnType<typeof createEdgePerformanceTiming>,
) {
  response.headers.set("server-timing", timing.finish(response.status).serverTiming);
  if (response.headers.has("access-control-allow-origin")) {
    response.headers.set("access-control-expose-headers", "server-timing, x-request-id");
  }
  return response;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
