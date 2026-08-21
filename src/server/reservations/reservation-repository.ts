import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ReservationCommandResult = {
  ok: boolean;
  code?: string;
  reservationId?: string;
  status?: "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  version?: number;
  startsAt?: string;
  endsAt?: string;
  preorderOpensAt?: string;
  preorderCutoffAt?: string;
  refundStatus?: "NOT_APPLICABLE";
  idempotentReplay?: boolean;
};

export type ReservationPreorderSessionResult = {
  ok: boolean;
  code?: string;
  sessionId?: string;
  reservationId?: string;
  reservationVersion?: number;
  scheduledFor?: string;
  expiresAt?: string;
  idempotentReplay?: boolean;
};

async function jsonResult<T>(query: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ result: T | null }>>(query);
  return rows[0]?.result ?? null;
}
export function createReservationRecord(input: {
  organizationId: string;
  stallId: string;
  diningTableId: string;
  publicTokenHash: string;
  partySize: number;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  requestId: string;
  actorProfileId: string | null;
}) {
  return jsonResult<ReservationCommandResult>(Prisma.sql`
    select app_private.create_reservation(
      ${input.organizationId}::uuid,
      ${input.stallId}::uuid,
      ${input.diningTableId}::uuid,
      ${input.publicTokenHash}::text,
      ${input.partySize}::smallint,
      ${input.startsAt}::timestamptz,
      ${input.endsAt}::timestamptz,
      ${input.timezone}::text,
      ${input.requestId}::text,
      ${input.actorProfileId}::uuid
    ) as result
  `);
}

export function modifyReservationRecord(input: {
  reservationId: string;
  organizationId: string;
  stallId: string;
  expectedVersion: number;
  diningTableId: string;
  partySize: number;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  requestId: string;
  actorProfileId: string | null;
}) {
  return jsonResult<ReservationCommandResult>(Prisma.sql`
    select app_private.modify_reservation(
      ${input.reservationId}::uuid,
      ${input.organizationId}::uuid,
      ${input.stallId}::uuid,
      ${input.expectedVersion}::integer,
      ${input.diningTableId}::uuid,
      ${input.partySize}::smallint,
      ${input.startsAt}::timestamptz,
      ${input.endsAt}::timestamptz,
      ${input.timezone}::text,
      ${input.requestId}::text,
      ${input.actorProfileId}::uuid
    ) as result
  `);
}

export function cancelReservationRecord(input: {
  reservationId: string;
  organizationId: string;
  stallId: string;
  expectedVersion: number;
  reasonCode: string;
  requestId: string;
  actorProfileId: string | null;
}) {
  return jsonResult<ReservationCommandResult>(Prisma.sql`
    select app_private.cancel_reservation(
      ${input.reservationId}::uuid,
      ${input.organizationId}::uuid,
      ${input.stallId}::uuid,
      ${input.expectedVersion}::integer,
      ${input.reasonCode}::text,
      ${input.requestId}::text,
      ${input.actorProfileId}::uuid
    ) as result
  `);
}

export function issueReservationPreorderSessionRecord(input: {
  reservationTokenHash: string;
  sessionTokenHash: string;
  deviceHash: string;
  sessionRequestId: string;
  requestId: string;
}) {
  return jsonResult<ReservationPreorderSessionResult>(Prisma.sql`
    select app_private.issue_reservation_preorder_session(
      ${input.reservationTokenHash}::text,
      ${input.sessionTokenHash}::text,
      ${input.deviceHash}::text,
      ${input.sessionRequestId}::uuid,
      ${input.requestId}::text
    ) as result
  `);
}
