import {
  mobileBootstrapResponseSchema,
  mobileDashboardResponseSchema,
  mobileErrorSchema,
  mobileLoginResponseSchema,
  mobileOrderDetailResponseSchema,
  mobileOrderListResponseSchema,
  mobileSessionRefreshResponseSchema,
  type MobileBootstrapResponse,
  type MobileOrderStatus,
} from "@stallorder/contracts/mobile/v1";
import { apiErrorSchema } from "@stallorder/contracts/operations/v1";
import { normalizeApiBaseUrl } from "./base-url";

export const apiBaseUrl = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);

const privateFetch: typeof fetch = (input, init) => fetch(input, {...init, credentials:"omit"});
export class MobileApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAt = 0,
  ) {
    super(message);
  }
}

export function retryAfterDeadline(value:string|null,now=Date.now()){
 if(value&&/^\d+$/.test(value.trim()))return now+Math.max(1,Number(value))*1000;
 const date=value?Date.parse(value):NaN;
 return Number.isFinite(date)?Math.max(now+1000,date):now+60000;
}
export async function responseJson(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = mobileErrorSchema.or(apiErrorSchema).safeParse(body);
    throw new MobileApiError(
      error.success ? error.data.code : "UNEXPECTED_RESPONSE",
      error.success ? error.data.message : "伺服器暫時無法處理請求。",
      response.status,
      response.status === 429 ? retryAfterDeadline(response.headers.get("retry-after")) : 0,
    );
  }
  return body;
}

export function authenticatedHeaders(token: string, deviceId: string) {
  return {
    authorization: `Bearer ${token}`,
    "x-stallorder-device-id": deviceId,
  };
}

export async function login(email: string, password: string, deviceId: string) {
  const response = await privateFetch(`${apiBaseUrl}/api/mobile/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-stallorder-client": "mobile-v1" },
    body: JSON.stringify({ email, password, deviceId }),
  });
  return mobileLoginResponseSchema.parse(await responseJson(response));
}

export async function bootstrap(token: string, deviceId: string): Promise<MobileBootstrapResponse> {
  const response = await privateFetch(`${apiBaseUrl}/api/mobile/v1/bootstrap`, {
    headers: { ...authenticatedHeaders(token, deviceId), "x-stallorder-client": "mobile-v1" },
  });
  return mobileBootstrapResponseSchema.parse(await responseJson(response));
}

export async function logout(token: string, deviceId: string) {
  const response = await privateFetch(`${apiBaseUrl}/api/mobile/v1/auth/logout`, {
    method: "POST",
    headers: { ...authenticatedHeaders(token, deviceId), "x-stallorder-client": "mobile-v1" },
  });
  await responseJson(response);
}

export async function refreshSession(token: string, deviceId: string) {
  const response = await privateFetch(`${apiBaseUrl}/api/mobile/v1/auth/refresh`, {
    method: "POST",
    headers: { ...authenticatedHeaders(token, deviceId), "x-stallorder-client": "mobile-v1" },
  });
  return mobileSessionRefreshResponseSchema.parse(await responseJson(response));
}

export async function dashboard(token: string, deviceId: string, stallId: string) {
  const response = await privateFetch(
    `${apiBaseUrl}/api/mobile/v1/stalls/${encodeURIComponent(stallId)}/dashboard`,
    { headers: { ...authenticatedHeaders(token, deviceId), "x-stallorder-client": "mobile-v1" } },
  );
  return mobileDashboardResponseSchema.parse(await responseJson(response));
}

export async function orders(
  token: string,
  deviceId: string,
  stallId: string,
  options: {
    statuses?: MobileOrderStatus[];
    query?: string;
    cursor?: string;
    limit?: number;
  } = {},
) {
  const search = new URLSearchParams();
  for (const status of options.statuses ?? []) search.append("status", status);
  if (options.query?.trim()) search.set("query", options.query.trim());
  if (options.cursor) search.set("cursor", options.cursor);
  if (options.limit) search.set("limit", String(options.limit));
  const serializedSearch = search.toString();
  const suffix = serializedSearch ? `?${serializedSearch}` : "";
  const response = await privateFetch(
    `${apiBaseUrl}/api/mobile/v1/stalls/${encodeURIComponent(stallId)}/orders${suffix}`,
    { headers: { ...authenticatedHeaders(token, deviceId), "x-stallorder-client": "mobile-v1" } },
  );
  return mobileOrderListResponseSchema.parse(await responseJson(response));
}

export async function orderDetail(token: string, deviceId: string, stallId: string, orderId: string) {
  const response = await privateFetch(
    `${apiBaseUrl}/api/mobile/v1/stalls/${encodeURIComponent(stallId)}/orders/${encodeURIComponent(orderId)}`,
    { headers: { ...authenticatedHeaders(token, deviceId), "x-stallorder-client": "mobile-v1" } },
  );
  return mobileOrderDetailResponseSchema.parse(await responseJson(response));
}
