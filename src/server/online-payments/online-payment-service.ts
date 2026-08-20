import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  createOnlineOrderPaymentIntentRecord,
  recordOnlineOrderPaymentEvent,
  reconcileOnlineOrderPaymentRecord,
} from "@/server/online-payments/online-payment-repository";

const MAX_WEBHOOK_BYTES = 64_000;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const uuid = z.string().uuid();
const requestId = z.string().trim().min(1).max(200);
const idempotencyKey = z.string().uuid();
const providerIntentId = z.string().regex(/^local_mock_pi_[0-9a-f]{32}$/);

const createIntentSchema = z.object({
  organizationId: uuid,
  stallId: uuid,
  orderId: uuid,
  idempotencyKey,
  requestId,
}).strict();

const reconcileSchema = z.object({
  organizationId: uuid,
  stallId: uuid,
  intentId: uuid,
  requestId,
}).strict();

const operationSchema = z.object({
  intentId: uuid,
  providerIntentId,
  orderId: uuid,
  amount: z.number().int().positive().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  operation: z.enum(["AUTHORIZE", "CAPTURE", "FAIL", "TIMEOUT"]),
  idempotencyKey,
  occurredAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.providerIntentId !== `local_mock_pi_${value.intentId.replaceAll("-", "")}`) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerIntentId"],
      message: "Local mock provider intent does not match the internal intent.",
    });
  }
});

const webhookSchema = z.object({
  provider: z.literal("LOCAL_MOCK"),
  eventId: z.string().regex(/^local_mock_evt_[0-9a-f]{32}$/),
  type: z.enum([
    "PAYMENT_AUTHORIZED",
    "PAYMENT_CAPTURED",
    "PAYMENT_FAILED",
    "PAYMENT_TIMED_OUT",
  ]),
  providerIntentId,
  createdAt: z.string().datetime({ offset: true }),
  data: z.object({
    orderReference: uuid,
    amount: z.number().int().positive().max(100_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }).strict(),
}).strict();

const eventTypeByOperation = {
  AUTHORIZE: "PAYMENT_AUTHORIZED",
  CAPTURE: "PAYMENT_CAPTURED",
  FAIL: "PAYMENT_FAILED",
  TIMEOUT: "PAYMENT_TIMED_OUT",
} as const;

export class OnlinePaymentError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 503,
  ) {
    super(code);
  }
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function requireWebhookSecret(override?: string) {
  const secret = override?.trim()
    || process.env.ONLINE_PAYMENT_LOCAL_MOCK_WEBHOOK_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new OnlinePaymentError("PAYMENT_WEBHOOK_SECRET_UNAVAILABLE");
  }
  return secret;
}

function assertLocalMockRuntime(environment: NodeJS.ProcessEnv) {
  if (environment.VERCEL_ENV === "production" || environment.NODE_ENV === "production") {
    throw new OnlinePaymentError("PAYMENT_LOCAL_MOCK_DISABLED_IN_PRODUCTION");
  }
}

function requireSuccess<T extends { ok: boolean; code: string }>(result: T | null): T {
  if (result?.ok) return result;
  const code = result?.code ?? "ONLINE_PAYMENT_UNAVAILABLE";
  const status = code.includes("NOT_FOUND") ? 404
    : code.includes("INVALID") ? 400
      : code.includes("DISABLED") ? 503
        : 409;
  throw new OnlinePaymentError(code, status);
}

function parseSignatureHeader(signature: string) {
  let timestamp: number | null = null;
  const digests: string[] = [];
  for (const component of signature.split(",")) {
    const [key, value] = component.trim().split("=", 2);
    if (key === "t" && /^\d+$/.test(value ?? "")) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/.test(value ?? "")) digests.push(value);
  }
  if (!timestamp || !Number.isSafeInteger(timestamp) || digests.length === 0) {
    throw new OnlinePaymentError("PAYMENT_WEBHOOK_SIGNATURE_INVALID", 400);
  }
  return { timestamp, digests };
}

function verifyWebhookSignature(input: {
  rawBody: Buffer;
  signature: string;
  secret: string;
  now: Date;
}) {
  const parsed = parseSignatureHeader(input.signature);
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new OnlinePaymentError("PAYMENT_WEBHOOK_TIMESTAMP_EXPIRED", 400);
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${parsed.timestamp}.`, "utf8")
    .update(input.rawBody)
    .digest();
  const valid = parsed.digests.some((digest) => {
    const candidate = Buffer.from(digest, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!valid) {
    throw new OnlinePaymentError("PAYMENT_WEBHOOK_SIGNATURE_INVALID", 400);
  }
  return new Date(parsed.timestamp * 1000);
}

export async function createOnlineOrderPaymentIntent(rawInput: unknown) {
  assertLocalMockRuntime(process.env);
  const input = createIntentSchema.parse(rawInput);
  const requestFingerprint = sha256(JSON.stringify({
    provider: "LOCAL_MOCK",
    organizationId: input.organizationId,
    stallId: input.stallId,
    orderId: input.orderId,
  }));
  const result = requireSuccess(await createOnlineOrderPaymentIntentRecord({
    ...input,
    requestFingerprint,
  }));
  return { ...result, provider: "LOCAL_MOCK" as const };
}

export function createLocalMockPaymentWebhook(
  rawInput: unknown,
  dependencies: {
    now?: () => Date;
    secret?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const input = operationSchema.parse(rawInput);
  assertLocalMockRuntime(dependencies.environment ?? process.env);
  const now = dependencies.now?.() ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const payload = {
    provider: "LOCAL_MOCK" as const,
    eventId: `local_mock_evt_${sha256(input.idempotencyKey).slice(0, 32)}`,
    type: eventTypeByOperation[input.operation],
    providerIntentId: input.providerIntentId,
    createdAt: input.occurredAt,
    data: {
      orderReference: input.orderId,
      amount: input.amount,
      currency: input.currency,
    },
  };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", requireWebhookSecret(dependencies.secret))
    .update(`${timestamp}.`, "utf8")
    .update(rawBody, "utf8")
    .digest("hex");
  return { rawBody, signature: `t=${timestamp},v1=${signature}` };
}

export async function processOnlineOrderPaymentWebhook(
  rawInput: {
    rawBody: string | Buffer;
    signature: string;
    requestId: string;
  },
  dependencies: { now?: () => Date; secret?: string } = {},
) {
  assertLocalMockRuntime(process.env);
  const validatedRequestId = requestId.parse(rawInput.requestId);
  const rawBody = Buffer.isBuffer(rawInput.rawBody)
    ? rawInput.rawBody
    : Buffer.from(rawInput.rawBody, "utf8");
  if (rawBody.length === 0 || rawBody.length > MAX_WEBHOOK_BYTES) {
    throw new OnlinePaymentError("PAYMENT_WEBHOOK_BODY_INVALID", 400);
  }
  const signatureTimestamp = verifyWebhookSignature({
    rawBody,
    signature: rawInput.signature,
    secret: requireWebhookSecret(dependencies.secret),
    now: dependencies.now?.() ?? new Date(),
  });
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new OnlinePaymentError("PAYMENT_WEBHOOK_BODY_INVALID", 400);
  }
  const event = webhookSchema.parse(decoded);
  return requireSuccess(await recordOnlineOrderPaymentEvent({
    provider: event.provider,
    providerEventId: event.eventId,
    providerIntentId: event.providerIntentId,
    eventType: event.type,
    providerCreatedAt: new Date(event.createdAt),
    signatureTimestamp,
    bodySha256: sha256(rawBody),
    orderReference: event.data.orderReference,
    amount: event.data.amount,
    currency: event.data.currency,
    requestId: validatedRequestId,
  }));
}

export async function reconcileOnlineOrderPayment(rawInput: unknown) {
  assertLocalMockRuntime(process.env);
  const input = reconcileSchema.parse(rawInput);
  return requireSuccess(await reconcileOnlineOrderPaymentRecord(input));
}
