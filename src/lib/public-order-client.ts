import { PublicOrderCircuitBreaker } from "@/lib/public-order-circuit-breaker";

const DEVICE_COOKIE = "stallorder_device";
const DEVICE_STORAGE_KEY = "stallorder_device:v1";
const DEVICE_STORAGE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_ORDER_PROTOCOL_VERSION = "1";
const CIRCUIT_TIMEOUT_MS = 4_000;
const AVAILABILITY_CACHE_MS = 2_000;
const NO_FALLBACK_CODES = new Set([
  "TURNSTILE_UNAVAILABLE",
  "QR_ORDERING_DEGRADED",
  "QR_ORDERING_UNAVAILABLE",
]);

export type PublicOrderOperation =
  | "create-order-session"
  | "create-public-order"
  | "get-public-order";

type PublicOrderRequestOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

export type PublicAvailabilityStatus =
  | "AVAILABLE"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "MAINTENANCE"
  | "UNKNOWN";

export type PublicAvailabilityConfig = {
  mode: "NORMAL_PRIMARY" | "NORMAL_DR" | "DEGRADED_SAFE" | "UNKNOWN";
  activeBackend: "PRIMARY" | "DR" | "UNKNOWN";
  promotionEpoch: number;
  orderIntake: "EDGE_PRIMARY" | "DUAL";
  qrOrdering: PublicAvailabilityStatus;
  staffOnline: PublicAvailabilityStatus;
  offlinePos: PublicAvailabilityStatus;
  linePay: PublicAvailabilityStatus;
  jkoPay: PublicAvailabilityStatus;
  updatedAt: string | null;
};

type AvailabilityCache = {
  expiresAt: number;
  config: PublicAvailabilityConfig | null;
};

const operationBreakers = new Map<PublicOrderOperation, PublicOrderCircuitBreaker>();
let availabilityCache: AvailabilityCache | null = null;
let availabilityRequest: Promise<PublicAvailabilityConfig | null> | null = null;

export function getOrCreateDeviceId() {
  const encodedCookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_COOKIE}=`))
    ?.slice(DEVICE_COOKIE.length + 1);

  if (encodedCookie) {
    try {
      const cookieDeviceId = decodeURIComponent(encodedCookie);
      if (UUID_PATTERN.test(cookieDeviceId)) {
        persistDeviceStorage(cookieDeviceId);
        return cookieDeviceId;
      }
    } catch {
      // Treat a malformed cookie as missing and recover from the local backup.
    }
  }

  const storedDevice = readDeviceStorage();
  if (storedDevice) {
    persistDeviceStorage(storedDevice.id);
    persistDeviceCookie(storedDevice.id);
    return storedDevice.id;
  }

  const deviceId = crypto.randomUUID();
  persistDeviceCookie(deviceId);
  persistDeviceStorage(deviceId);
  return deviceId;
}

function persistDeviceCookie(deviceId: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(deviceId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function readDeviceStorage() {
  try {
    const storedValue = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!storedValue) return null;
    if (UUID_PATTERN.test(storedValue)) {
      return { id: storedValue, expiresAt: null };
    }
    const parsed = JSON.parse(storedValue) as { id?: unknown; expiresAt?: unknown };
    if (
      typeof parsed.id !== "string"
      || !UUID_PATTERN.test(parsed.id)
      || typeof parsed.expiresAt !== "number"
      || !Number.isFinite(parsed.expiresAt)
      || parsed.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(DEVICE_STORAGE_KEY);
      return null;
    }
    return { id: parsed.id, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function persistDeviceStorage(deviceId: string) {
  try {
    const existing = readDeviceStorage();
    if (existing?.id === deviceId && existing.expiresAt !== null) return;
    window.localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({
      id: deviceId,
      expiresAt: Date.now() + DEVICE_STORAGE_MAX_AGE_MS,
    }));
  } catch {
    // Restricted browser storage must not block ordering.
  }
}

export function publicEdgeUrl(functionName: string) {
  const functionsUrl = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL?.trim().replace(/\/$/, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (functionsUrl && publishableKey && canCallEdgeDirectly()) return `${functionsUrl}/${functionName}`;
  return `/api/public-order/${functionName}`;
}

export function publicEdgeHeaders(): Record<string, string> {
  const functionsUrl = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!functionsUrl || !publishableKey || !canCallEdgeDirectly()) return {};
  return {
    apikey: publishableKey,
    authorization: `Bearer ${publishableKey}`,
  };
}

function canCallEdgeDirectly() {
  if (typeof window === "undefined") return true;
  return !window.location.hostname.toLowerCase().endsWith(".vercel.app");
}

export async function parseEdgeResponse(response: Response) {
  const payload = await response.json().catch(() => ({ error: "伺服器回應格式不正確。" }));
  return payload as Record<string, unknown>;
}

export function respondToFulfillmentTime(
  input: {
    trackingToken: string;
    deviceId: string;
    version: number;
    response: "ACCEPT" | "DECLINE";
  },
  options: Pick<PublicOrderRequestOptions, "fetchImpl" | "timeoutMs"> = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchImpl(
    `/api/public/orders/${encodeURIComponent(input.trackingToken)}/fulfillment-time`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: input.deviceId,
        version: input.version,
        response: input.response,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? CIRCUIT_TIMEOUT_MS),
    },
  );
}

export async function requestPublicOrder(
  operation: PublicOrderOperation,
  input: Record<string, unknown>,
  options: PublicOrderRequestOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CIRCUIT_TIMEOUT_MS;
  const now = options.now ?? browserNow;
  const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
  const serializedBody = JSON.stringify(input);
  const availability = resolveDualOrderIntake(fetchImpl, deviceId);
  const breaker = getOperationBreaker(operation);
  const primaryAllowed = breaker.allowRequest();

  if (!primaryAllowed && await availability) {
    logCircuitFallback(operation, "CIRCUIT_OPEN", null, 0);
    return requestCircuitB(
      operation,
      input,
      serializedBody,
      fetchImpl,
      timeoutMs,
      now,
    );
  }

  const primaryStartedAt = now();
  try {
    const primaryResponse = await requestCircuitA(
      operation,
      serializedBody,
      fetchImpl,
      timeoutMs,
    );
    const fallback = await infrastructureResponse(primaryResponse);
    if (!fallback) {
      breaker.recordSuccess();
      return primaryResponse;
    }

    breaker.recordInfrastructureFailure();
    if (!await availability) return primaryResponse;
    logCircuitFallback(
      operation,
      "INFRASTRUCTURE_RESPONSE",
      primaryResponse.status,
      now() - primaryStartedAt,
    );
    return requestCircuitB(
      operation,
      input,
      serializedBody,
      fetchImpl,
      timeoutMs,
      now,
    );
  } catch {
    breaker.recordInfrastructureFailure();
    if (!await availability) throw new Error("PUBLIC_ORDER_PRIMARY_UNAVAILABLE");
    logCircuitFallback(
      operation,
      "TRANSPORT_FAILURE",
      null,
      now() - primaryStartedAt,
    );
    return requestCircuitB(
      operation,
      input,
      serializedBody,
      fetchImpl,
      timeoutMs,
      now,
    );
  }
}

function getOperationBreaker(operation: PublicOrderOperation) {
  const current = operationBreakers.get(operation);
  if (current) return current;
  const breaker = new PublicOrderCircuitBreaker();
  operationBreakers.set(operation, breaker);
  return breaker;
}

function requestCircuitA(
  operation: PublicOrderOperation,
  serializedBody: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
) {
  return fetchImpl(publicEdgeUrl(operation), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stallorder-protocol-version": PUBLIC_ORDER_PROTOCOL_VERSION,
      ...publicEdgeHeaders(),
    },
    body: serializedBody,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function requestCircuitB(
  operation: PublicOrderOperation,
  input: Record<string, unknown>,
  serializedBody: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  now: () => number,
) {
  const startedAt = now();
  const commonHeaders = {
    "x-stallorder-protocol-version": PUBLIC_ORDER_PROTOCOL_VERSION,
  };
  const response = operation === "get-public-order"
    ? await fetchImpl(
      `/api/public/orders/${encodeURIComponent(String(input.trackingToken ?? ""))}`,
      {
        method: "GET",
        headers: {
          ...commonHeaders,
          "x-stallorder-device-id": String(input.deviceId ?? ""),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
    : await fetchImpl(
      operation === "create-order-session"
        ? "/api/public/order-session"
        : "/api/public/orders",
      {
        method: "POST",
        headers: {
          ...commonHeaders,
          "content-type": "application/json",
        },
        body: serializedBody,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  logCircuitEvent("PUBLIC_ORDER_CIRCUIT_B_COMPLETED", {
    operation,
    status: response.status,
    latencyMs: Math.max(0, Math.round((now() - startedAt) * 10) / 10),
  });
  return response;
}

async function infrastructureResponse(response: Response) {
  if (response.status !== 408 && response.status < 500) return false;
  const payload = await response.clone().json().catch(() => null) as {
    code?: unknown;
  } | null;
  const code = typeof payload?.code === "string" ? payload.code : "";
  return !NO_FALLBACK_CODES.has(code);
}

const availabilityStatuses = new Set<PublicAvailabilityStatus>([
  "AVAILABLE",
  "DEGRADED",
  "UNAVAILABLE",
  "MAINTENANCE",
  "UNKNOWN",
]);

function availabilityStatus(value: unknown): PublicAvailabilityStatus {
  return typeof value === "string" && availabilityStatuses.has(value as PublicAvailabilityStatus)
    ? value as PublicAvailabilityStatus
    : "UNKNOWN";
}

function parseAvailabilityConfig(payload: unknown): PublicAvailabilityConfig | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  return {
    mode: value.mode === "NORMAL_PRIMARY" || value.mode === "NORMAL_DR" || value.mode === "DEGRADED_SAFE"
      ? value.mode
      : "UNKNOWN",
    activeBackend: value.activeBackend === "PRIMARY" || value.activeBackend === "DR"
      ? value.activeBackend
      : "UNKNOWN",
    promotionEpoch: typeof value.promotionEpoch === "number"
      && Number.isSafeInteger(value.promotionEpoch)
      && value.promotionEpoch >= 1
      ? value.promotionEpoch
      : 1,
    orderIntake: value.orderIntake === "DUAL" ? "DUAL" : "EDGE_PRIMARY",
    qrOrdering: availabilityStatus(value.qrOrdering),
    staffOnline: availabilityStatus(value.staffOnline),
    offlinePos: availabilityStatus(value.offlinePos),
    linePay: availabilityStatus(value.linePay),
    jkoPay: availabilityStatus(value.jkoPay),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function getPublicAvailability(
  deviceId: string,
  options: {
    fetchImpl?: typeof fetch;
    forceRefresh?: boolean;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = Date.now();
  if (!options.forceRefresh && availabilityCache && availabilityCache.expiresAt > now) {
    return Promise.resolve(availabilityCache.config);
  }
  if (availabilityRequest) return availabilityRequest;

  availabilityRequest = fetchImpl("/api/availability/config", {
    method: "GET",
    headers: deviceId ? { "x-stallorder-device-id": deviceId } : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  }).then(async (response) => {
    if (!response.ok) return null;
    return parseAvailabilityConfig(await response.json().catch(() => null));
  }).catch(() => null).then((config) => {
    availabilityCache = {
      expiresAt: Date.now() + AVAILABILITY_CACHE_MS,
      config,
    };
    return config;
  }).finally(() => {
    availabilityRequest = null;
  });
  return availabilityRequest;
}

function resolveDualOrderIntake(fetchImpl: typeof fetch, deviceId: string) {
  return getPublicAvailability(deviceId, { fetchImpl })
    .then((config) => config?.orderIntake === "DUAL");
}

function logCircuitFallback(
  operation: PublicOrderOperation,
  reason: string,
  status: number | null,
  latencyMs: number,
) {
  logCircuitEvent("PUBLIC_ORDER_CIRCUIT_FALLBACK", {
    operation,
    from: "A",
    to: "B",
    reason,
    status,
    latencyMs: Math.max(0, Math.round(latencyMs * 10) / 10),
  });
}

function logCircuitEvent(
  event: string,
  fields: Record<string, string | number | null>,
) {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    ...fields,
  }));
}

function browserNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
