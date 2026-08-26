import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  organizationId: z.string().uuid(),
  marketEventId: z.string().uuid(),
  campaignId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
}).strict();

export type EventAttributionTokenPayload = z.infer<typeof payloadSchema>;

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(`v1.${encodedPayload}`, "utf8").digest("base64url");
}

export function createEventAttributionToken(payload: EventAttributionTokenPayload, secret: string) {
  if (secret.length < 32) throw new Error("EVENT_ATTRIBUTION_SECRET_INVALID");
  const encoded = Buffer.from(JSON.stringify(payloadSchema.parse(payload)), "utf8").toString("base64url");
  return `v1.${encoded}.${signature(encoded, secret)}`;
}

export function verifyEventAttributionToken(token: string, secret: string, nowEpochSeconds = Math.floor(Date.now() / 1000)) {
  const [version, encoded, supplied, extra] = token.split(".");
  if (version !== "v1" || !encoded || !supplied || extra || secret.length < 32) {
    throw new Error("EVENT_ATTRIBUTION_TOKEN_INVALID");
  }
  const expected = Buffer.from(signature(encoded, secret));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("EVENT_ATTRIBUTION_TOKEN_INVALID");
  }
  try {
    const payload = payloadSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (payload.expiresAt < nowEpochSeconds) throw new Error("EVENT_ATTRIBUTION_TOKEN_EXPIRED");
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === "EVENT_ATTRIBUTION_TOKEN_EXPIRED") throw error;
    throw new Error("EVENT_ATTRIBUTION_TOKEN_INVALID");
  }
}

export function requireEventAttributionSecret(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.EVENT_ATTRIBUTION_SIGNING_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (environment.NODE_ENV !== "production") return "stallorder-local-event-attribution-secret-v1";
  throw new Error("EVENT_ATTRIBUTION_SIGNING_SECRET_MISSING");
}
