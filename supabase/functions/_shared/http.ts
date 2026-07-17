const MAX_CONTENT_LENGTH = 32_000;

export class HttpInputError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

export function getCorsHeaders(request: Request, allowedOrigins: readonly string[]) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) {
    throw new HttpInputError("ORIGIN_NOT_ALLOWED", 403);
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  requestId: string,
) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

export async function readBoundedJson(request: Request, maxBytes = MAX_CONTENT_LENGTH) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpInputError("REQUEST_TOO_LARGE", 413);
  }

  if (!request.body) throw new HttpInputError("INVALID_JSON", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body limit exceeded");
        throw new HttpInputError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)) as unknown;
  } catch {
    throw new HttpInputError("INVALID_JSON", 400);
  }
}

export function getGatewayClientIp(
  request: Request,
  configuredHeader?: string,
) {
  const headerName = configuredHeader
    ?? Deno.env.get("TRUSTED_CLIENT_IP_HEADER")?.trim().toLowerCase()
    ?? (Deno.env.get("APP_ENV") === "production" ? undefined : "cf-connecting-ip");
  if (headerName !== "cf-connecting-ip" && headerName !== "x-real-ip") {
    throw new Error("TRUSTED_CLIENT_IP_HEADER must be cf-connecting-ip or x-real-ip.");
  }
  const candidate = request.headers.get(headerName)?.trim();
  if (!candidate || candidate.includes(",") || !isValidIp(candidate)) return "unknown";
  return candidate;
}

function isValidIp(value: string) {
  const ipv4 = value.split(".");
  if (ipv4.length === 4) {
    return ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  }
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

export function errorMessage(code: string) {
  const messages: Record<string, string> = {
    ORIGIN_NOT_ALLOWED: "不允許此網站送出訂單。",
    METHOD_NOT_ALLOWED: "不支援此請求方式。",
    REQUEST_TOO_LARGE: "請求內容過大。",
    INVALID_JSON: "請求格式不正確。",
    INVALID_REQUEST: "訂單資料不正確。",
    QR_NOT_FOUND: "找不到此 QR Code。",
    QR_REVOKED: "此 QR Code 已撤銷。",
    QR_PAUSED: "此 QR Code 已暫停接單。",
    QR_EXPIRED: "此 QR Code 已過期。",
    QR_NOT_ACTIVE: "此 QR Code 目前無法使用。",
    TABLE_UNAVAILABLE: "此內用桌位目前無法點餐。",
    QR_SESSION_MISMATCH: "點餐連結與 Session 不相符，請重新掃描。",
    STALL_CLOSED: "攤位目前已關閉點餐。",
    ORDERING_PAUSED: "攤位目前暫停接單。",
    STALL_SOLD_OUT: "攤位商品目前已售完。",
    TENANT_INACTIVE: "商戶目前無法接單。",
    SESSION_NOT_FOUND: "找不到點餐 Session，請重新掃描。",
    SESSION_EXPIRED: "點餐 Session 已過期，請重新掃描。",
    SESSION_REPLAYED: "此點餐 Session 已使用，無法再次下單。",
    SESSION_DEVICE_MISMATCH: "點餐 Session 無法在此裝置使用。",
    RATE_LIMITED: "操作過於頻繁，請稍後再試。",
    INVALID_TURNSTILE: "安全驗證失敗，請重新完成驗證。",
    TURNSTILE_UNAVAILABLE: "安全驗證暫時無法使用，請稍後再試。",
    INVALID_ITEMS: "請至少選擇一項商品。",
    TOO_MANY_OR_DUPLICATE_PRODUCTS: "商品種類過多或有重複商品。",
    EXCESSIVE_TOTAL_QUANTITY: "訂單總數量超過攤位限制。",
    EXCESSIVE_ITEM_QUANTITY: "單項商品數量超過攤位限制。",
    NOTE_TOO_LONG: "備註內容超過攤位限制。",
    PRODUCT_UNAVAILABLE: "部分商品已售完或無法供應。",
    INVALID_PRODUCT_NOTES: "商品註記已變更或選取不完整，請重新確認。",
    TOO_MANY_PENDING_ORDERS: "此裝置尚有過多待確認訂單。",
    ORDER_CONFLICT: "訂單發生衝突，請重新掃描後再試。",
    ORDER_CREATE_ERROR: "目前無法建立訂單，請稍後再試。",
    ORDER_NOT_FOUND: "找不到此訂單。",
  };
  return messages[code] ?? "目前無法處理此操作。";
}

export function statusForCode(code: string) {
  if (["QR_NOT_FOUND", "SESSION_NOT_FOUND", "ORDER_NOT_FOUND"].includes(code)) return 404;
  if (["QR_REVOKED", "QR_PAUSED", "QR_EXPIRED", "QR_NOT_ACTIVE", "QR_SESSION_MISMATCH", "STALL_CLOSED", "ORDERING_PAUSED", "STALL_SOLD_OUT", "TENANT_INACTIVE", "SESSION_EXPIRED", "SESSION_REPLAYED", "SESSION_DEVICE_MISMATCH"].includes(code)) return 409;
  if (code === "RATE_LIMITED" || code === "TOO_MANY_PENDING_ORDERS") return 429;
  if (code === "TURNSTILE_UNAVAILABLE") return 503;
  if (["ORDER_CONFLICT"].includes(code)) return 409;
  if (code === "INVALID_PRODUCT_NOTES") return 422;
  if (["ORDER_CREATE_ERROR"].includes(code)) return 500;
  return 400;
}
