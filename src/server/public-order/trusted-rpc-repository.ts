import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type StoredPublicOrder = {
  order_id: string;
  order_no: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  fulfillment_type?: string;
  pickup_required?: boolean;
  quoted_wait_minutes?: number | null;
  quoted_ready_at?: string | null;
  scheduled_pickup_at?: string | null;
  requested_fulfillment_at?: string | null;
  discount_amount?: number;
  created_at: string;
};

export type SessionIssueResult = {
  ok: boolean;
  code?: string;
  stall_id?: string;
  qr_code_id?: string;
  order_session_id?: string;
  expires_at?: string;
  idempotent_replay?: boolean;
  capacity?: {
    quote_min_minutes?: number;
    quote_max_minutes?: number;
    acknowledgment_threshold_minutes?: number;
    requires_acknowledgment?: boolean;
  };
};

export type OrderCreateResult = {
  ok: boolean;
  code?: string;
  idempotent_replay?: boolean;
  order?: StoredPublicOrder;
  capacity?: {
    quote_min_minutes?: number;
    quote_max_minutes?: number;
    requires_acknowledgment?: boolean;
  };
};

export type PublicOrderIntakeAvailability = {
  ok: boolean;
  code?: "QR_ORDERING_DEGRADED" | "QR_ORDERING_UNAVAILABLE";
};

export type PublicOrderPreflightResult = {
  ok: boolean;
  code?: string;
  scope?: "SESSION" | "ORDER";
  ordering_mode?: "DEFAULT" | "DELIVERY" | "PREORDER";
  qr_context?: {
    tenant_id: string;
    organization_id: string;
    stall_id: string;
    qr_code_id: string;
    dining_table_id?: string | null;
    fulfillment_type_context?: string | null;
    table?: {
      id: string;
      label: string;
      code: string;
      is_active: boolean;
    } | null;
    settings?: {
      max_item_quantity?: number;
      max_unique_products?: number;
      max_total_quantity?: number;
      max_note_length?: number;
      dine_in_enabled?: boolean;
      delivery_module_enabled?: boolean;
      takeout_preorder_enabled?: boolean;
      enabled_locales?: string[];
      estimated_wait_minutes?: number;
      lottery_enabled?: boolean;
    };
  } | null;
  schedule_context?: {
    ok: boolean;
    code?: string | null;
  } | null;
  capacity?: SessionIssueResult["capacity"] & {
    product_limit_exceeded?: boolean;
    pause_source?: string;
    accepting_public_orders?: boolean;
  };
  resumable_order?: {
    order_id: string;
    order_status: string;
  } | null;
  idempotent_order?: StoredPublicOrder & {
    lottery_draw_id?: string | null;
    pickup_code_length?: number | null;
  } | null;
};

async function jsonResult<T>(query: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ result: T | null }>>(query);
  return rows[0]?.result ?? null;
}

export function checkGlobalPublicRequestGate(input: {
  scope: "SESSION" | "ORDER" | "TRACKING";
  ipHash: string;
  deviceHash: string;
  behaviorHash: string;
  requestId: string;
}) {
  return jsonResult<{ ok: boolean; code?: string }>(Prisma.sql`
    select public.check_global_public_request_gate(
      ${input.scope}::text,
      ${input.ipHash}::text,
      ${input.deviceHash}::text,
      ${input.behaviorHash}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function preflightPublicOrder(input: {
  scope: "SESSION" | "ORDER";
  qrToken: string;
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
  deviceHash: string;
  ipHash: string;
  qrTokenHash: string;
  behaviorHash: string;
  requestId: string;
  sessionTokenHash?: string | null;
  idempotencyKey?: string | null;
  idempotencyHash?: string | null;
  requestedFulfillmentAt?: string | null;
  lotteryDrawId?: string | null;
  items?: Array<Record<string, unknown>>;
  waitAcknowledged?: boolean;
  intakeCode?: string | null;
}) {
  return jsonResult<PublicOrderPreflightResult>(Prisma.sql`
    select public.public_order_preflight_with_special_closure(
      ${input.scope}::text,
      ${input.qrToken}::text,
      ${input.orderingMode}::text,
      ${input.deviceHash}::text,
      ${input.ipHash}::text,
      ${input.qrTokenHash}::text,
      ${input.behaviorHash}::text,
      ${input.requestId}::text,
      ${input.sessionTokenHash ?? null}::text,
      ${input.idempotencyKey ?? null}::uuid,
      ${input.idempotencyHash ?? null}::text,
      ${input.requestedFulfillmentAt ?? null}::timestamptz,
      ${input.lotteryDrawId ?? null}::uuid,
      ${JSON.stringify(input.items ?? [])}::jsonb,
      ${input.waitAcknowledged ?? false}::boolean,
      ${input.intakeCode ?? null}::text
    ) as result
  `);
}

export function lookupResumablePublicOrder(input: {
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
  qrToken: string;
  deviceHash: string;
  ipHash: string;
  qrTokenHash: string;
  behaviorHash: string;
  requestId: string;
}) {
  const argumentsSql = Prisma.sql`
    ${input.qrToken}::text,
    ${input.deviceHash}::text,
    ${input.ipHash}::text,
    ${input.qrTokenHash}::text,
    ${input.behaviorHash}::text,
    ${input.requestId}::text,
    ${input.orderingMode}::text
  `;
  return input.orderingMode === "DELIVERY"
    ? jsonResult<{ order_id: string; order_status: string }>(Prisma.sql`
        select public.lookup_resumable_public_delivery_order(${argumentsSql}) as result
      `)
    : jsonResult<{ order_id: string; order_status: string }>(Prisma.sql`
        select public.lookup_resumable_public_order(${argumentsSql}) as result
      `);
}

export function checkPublicOrderIntakeAvailability(
  qrToken: string,
  deviceId: string,
) {
  return jsonResult<PublicOrderIntakeAvailability>(Prisma.sql`
    select public.check_public_order_intake_availability(
      ${qrToken}::text,
      ${deviceId}::uuid
    ) as result
  `);
}

export function resolvePublicOrderingMode(
  qrToken: string,
  requestedMode: "DEFAULT" | "DELIVERY" | "PREORDER",
) {
  return jsonResult<"DEFAULT" | "DELIVERY" | "PREORDER">(Prisma.sql`
    select public.resolve_public_ordering_mode(
      ${qrToken}::text,
      ${requestedMode}::text
    ) as result
  `);
}

export function issueIdempotentOrderSession(input: {
  qrToken: string;
  sessionTokenHash: string;
  ipHash: string;
  deviceHash: string;
  qrTokenHash: string;
  behaviorHash: string;
  requestId: string;
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
}) {
  return jsonResult<SessionIssueResult>(Prisma.sql`
    select public.issue_idempotent_order_session_with_schedule_targeted(
      ${input.qrToken}::text,
      ${input.sessionTokenHash}::text,
      ${input.ipHash}::text,
      ${input.deviceHash}::text,
      ${input.qrTokenHash}::text,
      ${input.behaviorHash}::text,
      ${input.requestId}::text,
      ${input.orderingMode}::text
    ) as result
  `);
}

export function getPublicSessionMenuContext(orderSessionId: string, stallId: string) {
  return prisma.qrCode.findFirst({
    where: {
      stallId,
      orderSessions: {
        some: {
          id: orderSessionId,
          status: "ACTIVE",
        },
      },
    },
    select: {
      diningTable: {
        select: {
          id: true,
          isActive: true,
        },
      },
      stall: {
        select: {
          orderingSettings: {
            select: {
              dineInEnabled: true,
              deliveryModuleEnabled: true,
            },
          },
        },
      },
    },
  });
}

export function revokeOrderSession(orderSessionId: string) {
  return prisma.orderSession.updateMany({
    where: {
      id: orderSessionId,
      status: "ACTIVE",
    },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
    },
  });
}

export function getOrderSessionMode(sessionTokenHash: string) {
  return prisma.orderSession.findUnique({
    where: { tokenHash: sessionTokenHash },
    select: {
      id: true,
      organizationId: true,
      stallId: true,
      qrCodeId: true,
      orderingMode: true,
    },
  });
}

export function lookupPublicOrderIdempotency(sessionTokenHash: string, idempotencyKey: string) {
  return jsonResult<StoredPublicOrder>(Prisma.sql`
    select public.lookup_public_order_idempotency(
      ${sessionTokenHash}::text,
      ${idempotencyKey}::uuid
    ) as result
  `);
}

export function checkPublicOrderSubmissionGate(input: {
  sessionTokenHash: string;
  ipHash: string;
  deviceHash: string;
  qrTokenHash: string;
  behaviorHash: string;
  requestId: string;
}) {
  return jsonResult<{ ok: boolean; code?: string }>(Prisma.sql`
    select public.check_public_order_submission_gate(
      ${input.sessionTokenHash}::text,
      ${input.ipHash}::text,
      ${input.deviceHash}::text,
      ${input.qrTokenHash}::text,
      ${input.behaviorHash}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function createPublicOrderWithSchedule(input: {
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
  orderId: string;
  qrToken: string;
  sessionTokenHash: string;
  deviceHash: string;
  ipHash: string;
  qrTokenHash: string;
  behaviorHash: string;
  idempotencyKey: string;
  idempotencyHash: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  customerNote: string;
  items: Array<{
    product_id: string;
    quantity: number;
    note: string;
    modifier_option_ids: string[];
    bundle_choice_ids: string[];
  }>;
  trackingTokenHash: string;
  pickupCodeHash: string;
  requestId: string;
  waitAcknowledged: boolean;
  scheduledPickupAt: string | null;
  lotteryDrawId: string | null;
}) {
  return jsonResult<OrderCreateResult>(Prisma.sql`
    select public.create_public_order_with_fulfillment_time_targeted(
      ${input.orderId}::uuid,
      ${input.qrToken}::text,
      ${input.sessionTokenHash}::text,
      ${input.deviceHash}::text,
      ${input.ipHash}::text,
      ${input.qrTokenHash}::text,
      ${input.behaviorHash}::text,
      ${input.idempotencyKey}::uuid,
      ${input.idempotencyHash}::text,
      ${input.customerName}::text,
      ${input.customerPhone}::text,
      ${input.deliveryAddress}::text,
      ${input.customerNote}::text,
      ${JSON.stringify(input.items)}::jsonb,
      ${input.trackingTokenHash}::text,
      ${input.pickupCodeHash}::text,
      ${input.requestId}::text,
      ${input.waitAcknowledged}::boolean,
      ${input.scheduledPickupAt}::timestamptz,
      ${input.lotteryDrawId}::uuid
    ) as result
  `);
}

export function getOrderQuote(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      fulfillmentType: true,
      pickupCodeLength: true,
      quotedWaitMinutes: true,
      quotedReadyAt: true,
      scheduledPickupAt: true,
      requestedFulfillmentAt: true,
      lotteryDrawId: true,
      discountAmount: true,
    },
  });
}

export function persistPickupCodeDisplay(orderId: string, pickupCode: string) {
  return prisma.order.updateMany({
    where: {
      id: orderId,
      fulfillmentType: "TAKEOUT",
    },
    data: {
      pickupCodeDisplay: pickupCode,
    },
  });
}

export function getTrackedPublicOrder(trackingTokenHash: string, deviceHash: string) {
  return jsonResult<Record<string, unknown> & {
    orderId: string;
    fulfillmentType?: string;
    pickupCodeLength?: number;
  }>(Prisma.sql`
    select public.get_public_order(
      ${trackingTokenHash}::text,
      ${deviceHash}::text
    ) as result
  `);
}

export function getTrackedOrderContext(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      source: true,
      stallId: true,
      diningTableId: true,
      quotedWaitMinutes: true,
      quotedReadyAt: true,
      stall: {
        select: {
          orderingSettings: {
            select: {
              estimatedWaitMinutes: true,
            },
          },
        },
      },
    },
  });
}

export function getLastDiningTableOrder(stallId: string, diningTableId: string) {
  return prisma.order.findFirst({
    where: {
      stallId,
      diningTableId,
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      createdAt: true,
    },
  });
}

export function recordPublicOrderAttempt(input: {
  requestId: string;
  eventType: string;
  reasonCode: string;
  organizationId?: string | null;
  stallId?: string | null;
  qrCodeId?: string | null;
  orderSessionId?: string | null;
  ipHash?: string | null;
  deviceHash?: string | null;
  qrTokenHash?: string | null;
  orderSessionHash?: string | null;
  behaviorHash?: string | null;
  idempotencyHash?: string | null;
}) {
  return prisma.$queryRaw(Prisma.sql`
    select public.record_public_order_attempt(
      ${input.requestId}::text,
      ${input.eventType}::text,
      'DENIED'::public.public_attempt_outcome,
      ${input.reasonCode}::text,
      ${input.organizationId ?? null}::uuid,
      ${input.stallId ?? null}::uuid,
      ${input.qrCodeId ?? null}::uuid,
      ${input.orderSessionId ?? null}::uuid,
      ${input.ipHash ?? null}::text,
      ${input.deviceHash ?? null}::text,
      ${input.qrTokenHash ?? null}::text,
      ${input.orderSessionHash ?? null}::text,
      ${input.behaviorHash ?? null}::text,
      ${input.idempotencyHash ?? null}::text
    ) as result
  `);
}
