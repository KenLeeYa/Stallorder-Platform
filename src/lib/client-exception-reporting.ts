import { createWebUuid } from "@/lib/web-uuid";

export type ClientExceptionType = "REACT_BOUNDARY" | "WINDOW_ERROR" | "UNHANDLED_REJECTION";

const ALLOWED_ERROR_NAMES = new Set([
  "Error",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
]);

export function clientErrorSurface(pathname: string) {
  const segment = pathname.split("/").filter(Boolean)[0] ?? "home";
  return /^[a-z0-9-]{1,40}$/i.test(segment) ? segment.toLowerCase() : "unknown";
}

export function clientExceptionPayload(input: {
  type: ClientExceptionType;
  error?: unknown;
  digest?: string;
  pathname?: string;
}) {
  const errorName = input.error instanceof Error && ALLOWED_ERROR_NAMES.has(input.error.name)
    ? input.error.name
    : input.error instanceof Error
      ? "Error"
      : "NonErrorThrown";
  const digest = input.digest?.trim();
  return {
    clientEventId: createWebUuid(),
    type: input.type,
    errorName,
    digest: digest && /^[A-Za-z0-9_-]{1,100}$/.test(digest) ? digest : undefined,
    surface: clientErrorSurface(input.pathname ?? "/"),
  };
}

export function reportClientException(input: {
  type: ClientExceptionType;
  error?: unknown;
  digest?: string;
}) {
  if (typeof window === "undefined") return;
  const payload = clientExceptionPayload({ ...input, pathname: window.location.pathname });
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}
