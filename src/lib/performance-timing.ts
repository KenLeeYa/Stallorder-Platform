import { performance } from "node:perf_hooks";

export type PerformanceTimingField =
  | "authMs"
  | "sessionMs"
  | "dbMs"
  | "dbConnectMs"
  | "edgeFunctionMs"
  | "turnstileMs"
  | "renderMs"
  | "externalApiMs";

type PerformanceTimingOptions = {
  route: string;
  requestId: string;
  operationId?: string;
  now?: () => number;
  logger?: PerformanceLogger;
};

type PerformanceLogger = (
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
) => void;

type FinishOptions = {
  status: number;
  level?: "info" | "warn" | "error";
};

const serverTimingNames: Record<PerformanceTimingField, string> = {
  authMs: "auth",
  sessionMs: "session",
  dbMs: "db",
  dbConnectMs: "db-connect",
  edgeFunctionMs: "edge-function",
  turnstileMs: "turnstile",
  renderMs: "render",
  externalApiMs: "external-api",
};

export function createPerformanceTiming(options: PerformanceTimingOptions) {
  const now = options.now ?? performance.now.bind(performance);
  const logger = options.logger ?? logPerformanceEvent;
  const startedAt = now();
  const durations: Partial<Record<PerformanceTimingField, number>> = {};
  let dbQueryCount = 0;
  let completed: { totalMs: number; serverTiming: string } | null = null;

  function add(field: PerformanceTimingField, durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    durations[field] = (durations[field] ?? 0) + durationMs;
  }

  async function measure<T>(field: PerformanceTimingField, operation: () => Promise<T>) {
    const operationStartedAt = now();
    try {
      return await operation();
    } finally {
      add(field, now() - operationStartedAt);
    }
  }

  async function measureDb<T>(operation: () => Promise<T>, queryCount = 1) {
    if (Number.isSafeInteger(queryCount) && queryCount > 0) dbQueryCount += queryCount;
    return measure("dbMs", operation);
  }

  function start() {
    return now();
  }

  function addSince(field: PerformanceTimingField, mark: number) {
    add(field, now() - mark);
  }

  function finish({ status, level = status >= 500 ? "error" : status >= 400 ? "warn" : "info" }: FinishOptions) {
    if (completed) return completed;

    const totalMs = round(now() - startedAt);
    const roundedDurations = Object.fromEntries(
      Object.entries(durations).map(([key, value]) => [key, round(value)]),
    );
    const serverTiming = [
      `total;dur=${totalMs}`,
      ...(dbQueryCount > 0 ? [`db-query-count;dur=${dbQueryCount}`] : []),
      ...Object.entries(roundedDurations).map(
        ([field, duration]) => `${serverTimingNames[field as PerformanceTimingField]};dur=${duration}`,
      ),
    ].join(", ");

    logger(level, "request_completed", {
      route: options.route,
      requestId: options.requestId,
      ...(options.operationId ? { operationId: options.operationId } : {}),
      status,
      totalMs,
      ...(dbQueryCount > 0 ? { dbQueryCount } : {}),
      ...roundedDurations,
    });
    completed = { totalMs, serverTiming };
    return completed;
  }

  return { add, addSince, finish, measure, measureDb, start };
}

export function finalizePerformanceResponse<T extends Response>(
  response: T,
  timing: ReturnType<typeof createPerformanceTiming>,
) {
  response.headers.set("server-timing", timing.finish({ status: response.status }).serverTiming);
  return response;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

const logPerformanceEvent: PerformanceLogger = (level, event, fields) => {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
};
