import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type DigitalWaitlistRpcFailure = {
  ok: false;
  code: string;
};

export type DigitalWaitlistJoinResult = DigitalWaitlistRpcFailure | {
  ok: true;
  code: "WAITLIST_JOINED";
  entry_id: string;
  status: "WAITING";
  position: number;
  joined_at: string;
};

export type DigitalWaitlistStatusResult = DigitalWaitlistRpcFailure | {
  ok: true;
  code: "WAITLIST_STATUS";
  entry_id: string;
  stall_id: string;
  display_name: string;
  party_size: number;
  status: "WAITING" | "NOTIFIED" | "SEATED" | "CANCELLED" | "NO_SHOW";
  state_version: number;
  position: number | null;
  hold_expires_at: string | null;
  table_label: string | null;
  updated_at: string;
};

export type DigitalWaitlistTransitionResult = DigitalWaitlistRpcFailure | {
  ok: true;
  code: "WAITLIST_STATE_CHANGED";
  entry_id: string;
  status: "NOTIFIED" | "SEATED" | "CANCELLED" | "NO_SHOW";
  state_version: number;
  hold_expires_at: string | null;
  seating_exchange_expires_at: string | null;
  assigned_dining_table_id: string | null;
};

export type DigitalWaitlistExchangeResult = DigitalWaitlistRpcFailure | {
  ok: true;
  code: "DINE_IN_SESSION_ISSUED";
  organization_id: string;
  stall_id: string;
  qr_code_id: string;
  dining_table_id: string;
  order_session_id: string;
  ordering_mode: "DEFAULT";
  expires_at: string;
};

async function jsonResult<T>(query: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ result: T | null }>>(query);
  return rows[0]?.result ?? null;
}

export function joinWaitlist(input: {
  stallId: string;
  partySize: number;
  displayName: string;
  publicTokenHash: string;
  duplicateKeyHash: string;
  ipHash: string;
  requestId: string;
}) {
  return jsonResult<DigitalWaitlistJoinResult>(Prisma.sql`
    select public.join_digital_waitlist(
      ${input.stallId}::uuid,
      ${input.partySize}::integer,
      ${input.displayName}::text,
      ${input.publicTokenHash}::text,
      ${input.duplicateKeyHash}::text,
      ${input.ipHash}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function getWaitlistStatus(publicTokenHash: string) {
  return jsonResult<DigitalWaitlistStatusResult>(Prisma.sql`
    select public.get_digital_waitlist_status(
      ${publicTokenHash}::text
    ) as result
  `);
}

export function transitionWaitlistEntry(input: {
  organizationId: string;
  stallId: string;
  entryId: string;
  expectedVersion: number;
  operation: string;
  diningTableId: string | null;
  seatingTokenHash: string | null;
  actorProfileId: string;
  ipHash: string;
  requestId: string;
}) {
  return jsonResult<DigitalWaitlistTransitionResult>(Prisma.sql`
    select public.transition_digital_waitlist_entry(
      ${input.organizationId}::uuid,
      ${input.stallId}::uuid,
      ${input.entryId}::uuid,
      ${input.expectedVersion}::integer,
      ${input.operation}::text,
      ${input.diningTableId}::uuid,
      ${input.seatingTokenHash}::text,
      ${input.actorProfileId}::uuid,
      ${input.ipHash}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function exchangeWaitlistSeating(input: {
  publicTokenHash: string;
  seatingTokenHash: string;
  sessionTokenHash: string;
  deviceHash: string;
  ipHash: string;
  requestId: string;
}) {
  return jsonResult<DigitalWaitlistExchangeResult>(Prisma.sql`
    select public.exchange_digital_waitlist_seating(
      ${input.publicTokenHash}::text,
      ${input.seatingTokenHash}::text,
      ${input.sessionTokenHash}::text,
      ${input.deviceHash}::text,
      ${input.ipHash}::text,
      ${input.requestId}::text
    ) as result
  `);
}
