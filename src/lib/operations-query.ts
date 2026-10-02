import { queryOptions, hashKey, type QueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { apiErrorSchema, type ClientScope } from "./operations-read-contract";

export const OPERATIONS_AUTH_INVALIDATED = "stallorder:private-view-invalidated";
export function invalidateOperationsAuthority() { window.dispatchEvent(new Event(OPERATIONS_AUTH_INVALIDATED)); }
import { operationsKey } from "@stallorder/contracts/operations/v1/query-key";
export { operationsKey };
export class OperationsReadError extends Error {
  constructor(readonly status: number, message: string, readonly retryAt: number | null = null, readonly kind: "transport" | "schema" | "scope" = "transport") { super(message); }
}
export function retryOperationsReadNow(error: unknown, refetch: () => unknown) {
  if (error instanceof OperationsReadError && error.retryAt !== null && error.retryAt > Date.now()) return;
  void refetch();
}
export function retryAfterDeadline(value: string | null, now = Date.now()) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return now + Number(value) * 1000;
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(now, deadline) : null;
}
export function retryOperationsRead(failures: number, error: unknown) {
  if (failures >= 2 || !(error instanceof OperationsReadError) || error.kind !== "transport") return false;
  if (error.status === 429) return error.retryAt !== null && error.retryAt - Date.now() <= 60_000;
  return error.status === 0 || [500, 502, 503, 504].includes(error.status);
}
const readDeadlines = new WeakMap<QueryClient, Map<string, number>>();
export function disposeOperationsReadDeadlines(client: QueryClient) { readDeadlines.delete(client); }
function transportDeadlines(client: QueryClient) {
  let deadlines = readDeadlines.get(client);
  if (!deadlines) { deadlines = new Map(); readDeadlines.set(client, deadlines); }
  for (const [key, deadline] of deadlines) if (deadline <= Date.now()) deadlines.delete(key);
  return deadlines;
}
async function waitForReadDeadline(deadline: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, remaining);
    signal.addEventListener("abort", abort, { once: true });
  });
  signal.throwIfAborted();
}
export function readQueryOptions<T>(scope: ClientScope, resource: string, input: object, url: string, schema: z.ZodType<T>, authority?: { current: () => boolean; deny: () => void }) {
  return queryOptions<T, OperationsReadError>({
    queryKey: operationsKey(scope, resource, input), staleTime: 30_000, gcTime: 60_000, refetchOnWindowFocus: "always", refetchOnReconnect: "always",
    retry: retryOperationsRead,
    retryDelay: (count, error) => !(error instanceof OperationsReadError) || error.retryAt === null ? Math.min(1000 * 2 ** count, 4000) : Math.max(0, error.retryAt - Date.now()),
    queryFn: async ({ signal, client, queryKey }) => {
      if (authority && !authority.current()) throw new DOMException("Scope changed", "AbortError");
      const deadlines = transportDeadlines(client);
      const readIdentity = hashKey([queryKey, url]);
      const deadline = deadlines.get(readIdentity);
      if (deadline !== undefined) {
        await waitForReadDeadline(deadline, signal);
        if (authority && !authority.current()) throw new DOMException("Scope changed", "AbortError");
        deadlines.delete(readIdentity);
      }
      let response: Response;
      try { response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal }); }
      catch (error) { if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error; throw new OperationsReadError(0, "無法連線，請稍後重試。"); }
      signal.throwIfAborted();
      if (authority && !authority.current()) throw new DOMException("Scope changed", "AbortError");
      const body: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      if (authority && !authority.current()) throw new DOMException("Scope changed", "AbortError");
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) authority?.deny();
        const retryAt = retryAfterDeadline(response.headers.get("retry-after"));
        if (response.status === 429 && retryAt !== null && readDeadlines.get(client) === deadlines) deadlines.set(readIdentity, retryAt);
        const error = apiErrorSchema.safeParse(body);
        throw new OperationsReadError(response.status, error.success ? error.data.message : "讀取失敗，請重新整理。", retryAt);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new OperationsReadError(0, "資料格式不符，請重新整理。", null, "schema");
      const result = parsed.data as T & { scope?: ClientScope };
      if (result.scope && JSON.stringify(result.scope) !== JSON.stringify(scope)) {
        authority?.deny(); throw new OperationsReadError(403, "權限或工作範圍已更新，請重新整理。", null, "scope");
      }
      return parsed.data;
    },
  });
}
