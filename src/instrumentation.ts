import type { Instrumentation } from "next";
import { logEvent } from "@/lib/audit";

const SAFE_ERROR_NAMES = new Set([
  "Error",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
]);

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const errorName = error instanceof Error && SAFE_ERROR_NAMES.has(error.name)
    ? error.name
    : error instanceof Error
      ? "Error"
      : "NonErrorThrown";
  logEvent("error", "SERVER_UNEXPECTED_ERROR", {
    errorName,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
};
