import { createHash, randomBytes } from "node:crypto";

export function publicApiKeyHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createPublicApiCredential() {
  const randomPrefix = randomBytes(9).toString("base64url");
  const keyPrefix = `slo_v1_${randomPrefix}`;
  const rawKey = `${keyPrefix}_${randomBytes(32).toString("base64url")}`;
  return { rawKey, keyPrefix, keyHash: publicApiKeyHash(rawKey) };
}

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return /^slo_v1_[A-Za-z0-9_-]{8,24}_[A-Za-z0-9_-]{40,60}$/.test(token) ? token : null;
}
