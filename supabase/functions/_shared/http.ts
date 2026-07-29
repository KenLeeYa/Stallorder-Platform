import {
  errorMessage,
  statusForCode,
} from "./public-order-errors.ts";
import { isSupportedPublicOrderProtocol } from "./public-order-protocol.ts";

const MAX_CONTENT_LENGTH = 32_000;

export { errorMessage, statusForCode };

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
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-stallorder-protocol-version",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

export function assertSupportedPublicOrderProtocol(request: Request) {
  if (!isSupportedPublicOrderProtocol(request.headers.get("x-stallorder-protocol-version"))) {
    throw new HttpInputError("CLIENT_VERSION_UNSUPPORTED", 426);
  }
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
