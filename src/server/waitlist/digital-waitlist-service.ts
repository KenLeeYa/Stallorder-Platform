import "server-only";

import { createHmac } from "node:crypto";
import { createOpaqueToken, hashToken } from "@/lib/security";
import type { DigitalWaitlistOperation } from "@/server/waitlist/digital-waitlist-contract";
import {
  exchangeWaitlistSeating,
  getWaitlistStatus,
  joinWaitlist,
  transitionWaitlistEntry,
  type DigitalWaitlistRpcFailure,
} from "@/server/waitlist/digital-waitlist-repository";

const statusByCode: Record<string, number> = {
  DIGITAL_WAITLIST_DISABLED: 404,
  WAITLIST_STALL_NOT_FOUND: 404,
  WAITLIST_NOT_FOUND: 404,
  WAITLIST_INVALID_INPUT: 400,
  WAITLIST_SEATING_INPUT_INVALID: 400,
  WAITLIST_ALREADY_ACTIVE: 409,
  WAITLIST_TOKEN_COLLISION: 409,
  WAITLIST_VERSION_CONFLICT: 409,
  WAITLIST_TRANSITION_INVALID: 409,
  WAITLIST_HOLD_ACTIVE: 409,
  WAITLIST_OPERATION_INVALID: 400,
  WAITLIST_SEATING_CONTRACT_INVALID: 409,
  WAITLIST_SEATING_TOKEN_INVALID: 409,
  WAITLIST_SEATING_TOKEN_USED: 409,
  WAITLIST_SEATING_TOKEN_EXPIRED: 409,
  WAITLIST_DINE_IN_QR_UNAVAILABLE: 409,
  WAITLIST_DINE_IN_UNAVAILABLE: 409,
  WAITLIST_RATE_LIMITED: 429,
  SESSION_TOKEN_COLLISION: 409,
};

export class DigitalWaitlistError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = statusByCode[code] ?? 503,
  ) {
    super(code);
  }
}

function requireAbuseHashSecret() {
  const secret = process.env.ABUSE_HASH_SECRET?.trim();
  if (!secret) throw new DigitalWaitlistError("DIGITAL_WAITLIST_UNAVAILABLE", 503);
  return secret;
}

function hmac(value: string) {
  return createHmac("sha256", requireAbuseHashSecret()).update(value).digest("hex");
}

function assertSuccess<T extends { ok: boolean; code?: string }>(
  result: T | null,
): asserts result is Exclude<T, DigitalWaitlistRpcFailure> & { ok: true } {
  if (!result?.ok) {
    throw new DigitalWaitlistError(result?.code ?? "DIGITAL_WAITLIST_UNAVAILABLE");
  }
}

export async function joinDigitalWaitlist(input: {
  stallId: string;
  partySize: number;
  displayName: string;
  deviceId: string;
  ipHash: string;
  requestId: string;
}) {
  const publicToken = createOpaqueToken();
  const result = await joinWaitlist({
    stallId: input.stallId,
    partySize: input.partySize,
    displayName: input.displayName,
    publicTokenHash: hashToken(publicToken),
    duplicateKeyHash: hmac(`waitlist:${input.stallId}:device:${input.deviceId}`),
    ipHash: input.ipHash,
    requestId: input.requestId,
  });
  assertSuccess(result);
  return {
    publicToken,
    entryId: result.entry_id,
    status: result.status,
    position: result.position,
    joinedAt: result.joined_at,
  };
}

export async function getDigitalWaitlistStatus(publicToken: string) {
  const result = await getWaitlistStatus(hashToken(publicToken));
  assertSuccess(result);
  return {
    entryId: result.entry_id,
    stallId: result.stall_id,
    displayName: result.display_name,
    partySize: result.party_size,
    status: result.status,
    stateVersion: result.state_version,
    position: result.position,
    holdExpiresAt: result.hold_expires_at,
    tableLabel: result.table_label,
    updatedAt: result.updated_at,
  };
}

export async function transitionDigitalWaitlistEntry(input: {
  organizationId: string;
  stallId: string;
  entryId: string;
  expectedVersion: number;
  operation: DigitalWaitlistOperation;
  diningTableId: string | null;
  actorProfileId: string;
  ipHash: string;
  requestId: string;
}) {
  const seatingToken = input.operation === "SEAT" ? createOpaqueToken() : null;
  const result = await transitionWaitlistEntry({
    ...input,
    seatingTokenHash: seatingToken ? hashToken(seatingToken) : null,
  });
  assertSuccess(result);
  return {
    entryId: result.entry_id,
    status: result.status,
    stateVersion: result.state_version,
    holdExpiresAt: result.hold_expires_at,
    seatingExchangeExpiresAt: result.seating_exchange_expires_at,
    assignedDiningTableId: result.assigned_dining_table_id,
    seatingToken,
  };
}

export async function exchangeDigitalWaitlistSeating(input: {
  publicToken: string;
  seatingToken: string;
  deviceId: string;
  ipHash: string;
  requestId: string;
}) {
  const orderSessionToken = createOpaqueToken();
  const result = await exchangeWaitlistSeating({
    publicTokenHash: hashToken(input.publicToken),
    seatingTokenHash: hashToken(input.seatingToken),
    sessionTokenHash: hashToken(orderSessionToken),
    deviceHash: hmac(`device:${input.deviceId}`),
    ipHash: input.ipHash,
    requestId: input.requestId,
  });
  assertSuccess(result);
  return {
    orderSessionToken,
    organizationId: result.organization_id,
    stallId: result.stall_id,
    qrCodeId: result.qr_code_id,
    diningTableId: result.dining_table_id,
    orderSessionId: result.order_session_id,
    orderingMode: result.ordering_mode,
    expiresAt: result.expires_at,
  };
}
