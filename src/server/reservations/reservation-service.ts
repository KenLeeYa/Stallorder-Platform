import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  cancelReservationRecord,
  createReservationRecord,
  issueReservationPreorderSessionRecord,
  modifyReservationRecord,
  type ReservationCommandResult,
  type ReservationPreorderSessionResult,
} from "@/server/reservations/reservation-repository";

const uuid = z.string().uuid();
const requestId = z.string().trim().min(1).max(200);
const actorProfileId = uuid.nullable().default(null);
const reservationScope = {
  organizationId: uuid,
  stallId: uuid,
};
const reservationSchedule = {
  diningTableId: uuid,
  partySize: z.number().int().min(1).max(20),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(100),
};

function validateRange(
  value: { startsAt: string; endsAt: string },
  context: z.RefinementCtx,
) {
  const start = Date.parse(value.startsAt);
  const end = Date.parse(value.endsAt);
  if (end <= start || end - start > 6 * 60 * 60 * 1000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "Reservation must end after it starts and last no more than six hours.",
    });
  }
}

export const createReservationSchema = z.object({
  ...reservationScope,
  ...reservationSchedule,
  requestId,
  actorProfileId,
}).strict().superRefine(validateRange);

export const modifyReservationSchema = z.object({
  reservationId: uuid,
  ...reservationScope,
  expectedVersion: z.number().int().positive(),
  ...reservationSchedule,
  requestId,
  actorProfileId,
}).strict().superRefine(validateRange);

export const cancelReservationSchema = z.object({
  reservationId: uuid,
  ...reservationScope,
  expectedVersion: z.number().int().positive(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/),
  requestId,
  actorProfileId,
}).strict();

export const issueReservationPreorderSessionSchema = z.object({
  reservationToken: z.string().regex(/^str_[A-Za-z0-9_-]{43}$/),
  deviceId: uuid,
  sessionRequestId: uuid,
  requestId,
}).strict();

export class ReservationServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

function statusForCode(code: string) {
  if (code === "RESERVATION_FEATURE_DISABLED") return 503;
  if (code === "RESERVATION_INVALID" || code === "RESERVATION_SCOPE_INVALID") return 404;
  if (code === "RESERVATION_INVALID_INPUT") return 400;
  if (code === "RESERVATION_INTERNAL_ERROR") return 500;
  return 409;
}

function requireSuccess<T extends { ok: boolean; code?: string }>(result: T | null): T {
  if (result?.ok) return result;
  const code = result?.code ?? "RESERVATION_INTERNAL_ERROR";
  throw new ReservationServiceError(code, statusForCode(code));
}

function requireSecret(name: "ABUSE_HASH_SECRET" | "TOKEN_DERIVATION_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`RESERVATION_${name}_MISSING`);
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomOpaqueToken(prefix: "str_") {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function deriveSessionToken(input: z.infer<typeof issueReservationPreorderSessionSchema>) {
  const digest = createHmac("sha256", requireSecret("TOKEN_DERIVATION_SECRET"))
    .update([
      "reservation-preorder-session",
      input.reservationToken,
      input.deviceId,
      input.sessionRequestId,
    ].join(":"))
    .digest("base64url");
  return `strps_${digest}`;
}

function requireReservationShape(result: ReservationCommandResult) {
  if (!result.reservationId || !result.status || result.version === undefined) {
    throw new ReservationServiceError("RESERVATION_INTERNAL_ERROR", 500);
  }
  return result as Required<Pick<
    ReservationCommandResult,
    "reservationId" | "status" | "version"
  >> & ReservationCommandResult;
}

function requireSessionShape(result: ReservationPreorderSessionResult) {
  if (
    !result.sessionId
    || !result.reservationId
    || result.reservationVersion === undefined
    || !result.scheduledFor
    || !result.expiresAt
  ) {
    throw new ReservationServiceError("RESERVATION_INTERNAL_ERROR", 500);
  }
  return result as Required<Pick<
    ReservationPreorderSessionResult,
    "sessionId" | "reservationId" | "reservationVersion" | "scheduledFor" | "expiresAt"
  >> & ReservationPreorderSessionResult;
}

export async function createReservation(rawInput: unknown) {
  const input = createReservationSchema.parse(rawInput);
  const reservationToken = randomOpaqueToken("str_");
  const result = requireReservationShape(requireSuccess(await createReservationRecord({
    ...input,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    publicTokenHash: sha256(reservationToken),
  })));
  return { ...result, reservationToken };
}

export async function modifyReservation(rawInput: unknown) {
  const input = modifyReservationSchema.parse(rawInput);
  return requireReservationShape(requireSuccess(await modifyReservationRecord({
    ...input,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
  })));
}

export async function cancelReservation(rawInput: unknown) {
  const input = cancelReservationSchema.parse(rawInput);
  return requireReservationShape(requireSuccess(await cancelReservationRecord(input)));
}

export async function issueReservationPreorderSession(rawInput: unknown) {
  const input = issueReservationPreorderSessionSchema.parse(rawInput);
  const sessionToken = deriveSessionToken(input);
  const deviceHash = createHmac("sha256", requireSecret("ABUSE_HASH_SECRET"))
    .update(`reservation-device:${input.deviceId}`)
    .digest("hex");
  const result = requireSessionShape(requireSuccess(
    await issueReservationPreorderSessionRecord({
      reservationTokenHash: sha256(input.reservationToken),
      sessionTokenHash: sha256(sessionToken),
      deviceHash,
      sessionRequestId: input.sessionRequestId,
      requestId: input.requestId,
    }),
  ));
  return { ...result, sessionToken };
}
