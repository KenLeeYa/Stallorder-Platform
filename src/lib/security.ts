import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const LOCAL_IP_HASH_SECRET = "stallorder-development-ip-hash-secret";

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }

  return null;
}

export function getClientIp(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "unknown";

  const cloudflareIp = request.headers.get("cf-connecting-ip");
  if (cloudflareIp) return cloudflareIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || "unknown";
}

export function hashClientIp(request: Request) {
  const configuredSecret = process.env.AUDIT_IP_HASH_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new Error("正式環境必須設定 AUDIT_IP_HASH_SECRET。");
  }

  return createHmac("sha256", configuredSecret || LOCAL_IP_HASH_SECRET)
    .update(getClientIp(request))
    .digest("hex");
}

export function createRequestId() {
  return randomUUID();
}

export function isTrustedOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  let suppliedOrigin: string | null = null;

  try {
    suppliedOrigin = originHeader
      ? new URL(originHeader).origin
      : refererHeader
        ? new URL(refererHeader).origin
        : null;
  } catch {
    return false;
  }

  if (!suppliedOrigin) return false;

  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredUrl) {
    try {
      return suppliedOrigin === new URL(configuredUrl).origin;
    } catch {
      return false;
    }
  }

  return suppliedOrigin === new URL(request.url).origin;
}

export function sanitizeRedirectPath(value: unknown, fallback = "/") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
