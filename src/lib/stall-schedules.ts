import "server-only";

import { Prisma, type FulfillmentType, type StallScheduleStatus } from "@prisma/client";
import type {
  MarketEventCommand,
  ScheduleCapabilities,
  StallLocationCommand,
  StallScheduleCommand,
} from "@/lib/stall-schedule-contract";
import { prisma } from "@/lib/prisma";
import {
  invalidateOrganizationPublicMenus,
  invalidatePublicMenu,
  invalidatePublicQrToken,
} from "@/lib/public-menu";
import { EntitlementError, entitlementService } from "@/server/billing/entitlement-service";

export class StallScheduleOperationError extends Error {
  constructor(public readonly code:
    | "STALL_NOT_FOUND"
    | "LOCATION_NOT_FOUND"
    | "LOCATION_LIMIT_REACHED"
    | "LOCATION_IN_USE"
    | "EVENT_NOT_FOUND"
    | "EVENT_FEATURE_REQUIRED"
    | "EVENT_IN_USE"
    | "SCHEDULE_NOT_FOUND"
    | "SCHEDULE_LIMIT_REACHED"
    | "SCHEDULE_IN_USE"
    | "SCHEDULE_TRANSITION_DENIED"
    | "SCHEDULE_CONTEXT_INVALID"
    | "SCHEDULE_EVENT_WINDOW_INVALID"
    | "RECURRING_COPY_REQUIRED"
    | "EVENT_SCHEDULE_NOT_COPYABLE"
    | "AUTOMATIC_ORDERING_REQUIRED"
    | "QR_CODE_NOT_FOUND"
    | "QR_ORDER_TYPE_INVALID"
    | "DELIVERY_MODULE_REQUIRED") {
    super(code);
    this.name = "StallScheduleOperationError";
  }
}

const allowedScheduleTransitions: Record<StallScheduleStatus, readonly StallScheduleStatus[]> = {
  SCHEDULED: ["OPEN", "DELAYED", "CANCELLED"],
  OPEN: ["COMPLETED", "CANCELLED"],
  DELAYED: ["OPEN", "CANCELLED"],
  CANCELLED: [],
  COMPLETED: [],
};

export function canTransitionSchedule(current: StallScheduleStatus, next: StallScheduleStatus) {
  return allowedScheduleTransitions[current].includes(next);
}

export async function getStallLocationManagerData(organizationId: string, stallId: string) {
  const capabilities = await getScheduleCapabilities(organizationId);
  const [stall, locations] = await Promise.all([
    prisma.stall.findFirst({
      where: { id: stallId, organizationId },
      select: { id: true, name: true, timezone: true },
    }),
    prisma.stallLocation.findMany({
      where: { organizationId, stallId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
  ]);
  if (!stall) throw new StallScheduleOperationError("STALL_NOT_FOUND");
  return { stall, capabilities, locations: locations.map(serializeLocation) };
}

export async function applyStallLocationCommand(input: {
  organizationId: string;
  stallId: string;
  command: StallLocationCommand;
}) {
  const capabilities = await getScheduleCapabilities(input.organizationId);
  const { command } = input;
  if (command.operation === "CREATE") {
    if (capabilities.locationLimit !== null) {
      const count = await prisma.stallLocation.count({
        where: { organizationId: input.organizationId, stallId: input.stallId },
      });
      if (count >= capabilities.locationLimit) {
        throw new StallScheduleOperationError("LOCATION_LIMIT_REACHED");
      }
    }
    return prisma.stallLocation.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        ...locationValues(command),
      },
    });
  }
  const existing = await prisma.stallLocation.findFirst({
    where: { id: command.locationId, organizationId: input.organizationId, stallId: input.stallId },
    select: { id: true },
  });
  if (!existing) throw new StallScheduleOperationError("LOCATION_NOT_FOUND");
  if (command.operation === "UPDATE") {
    return prisma.stallLocation.update({
      where: { id: existing.id },
      data: locationValues(command),
    });
  }
  const references = await Promise.all([
    prisma.stallSchedule.count({ where: { locationId: existing.id } }),
    prisma.qrCode.count({ where: { locationId: existing.id } }),
    prisma.order.count({ where: { locationId: existing.id } }),
  ]);
  if (references.some((count) => count > 0)) {
    throw new StallScheduleOperationError("LOCATION_IN_USE");
  }
  return prisma.stallLocation.delete({ where: { id: existing.id } });
}

export async function getMarketEventManagerData(organizationId: string) {
  const capabilities = await getScheduleCapabilities(organizationId);
  if (!capabilities.eventSchedule) throw new StallScheduleOperationError("EVENT_FEATURE_REQUIRED");
  const events = await prisma.marketEvent.findMany({
    where: { organizationId },
    orderBy: [{ startsAt: "desc" }, { name: "asc" }],
    take: 200,
  });
  return { capabilities, events: events.map(serializeEvent) };
}

export async function applyMarketEventCommand(input: {
  organizationId: string;
  command: MarketEventCommand;
}) {
  const capabilities = await getScheduleCapabilities(input.organizationId);
  if (!capabilities.eventSchedule) throw new StallScheduleOperationError("EVENT_FEATURE_REQUIRED");
  const { command } = input;
  if (command.operation === "CREATE") {
    return prisma.marketEvent.create({
      data: { organizationId: input.organizationId, ...eventValues(command) },
    });
  }
  const existing = await prisma.marketEvent.findFirst({
    where: { id: command.eventId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!existing) throw new StallScheduleOperationError("EVENT_NOT_FOUND");
  if (command.operation === "UPDATE") {
    return prisma.marketEvent.update({
      where: { id: existing.id },
      data: eventValues(command),
    });
  }
  const references = await Promise.all([
    prisma.stallSchedule.count({ where: { marketEventId: existing.id } }),
    prisma.qrCode.count({ where: { marketEventId: existing.id } }),
    prisma.order.count({ where: { marketEventId: existing.id } }),
  ]);
  if (references.some((count) => count > 0)) throw new StallScheduleOperationError("EVENT_IN_USE");
  return prisma.marketEvent.delete({ where: { id: existing.id } });
}

export async function getStallScheduleManagerData(organizationId: string, stallId: string) {
  const capabilities = await getScheduleCapabilities(organizationId);
  const [stall, locations, events, schedules, qrCodes] = await Promise.all([
    prisma.stall.findFirst({
      where: { id: stallId, organizationId },
      select: { id: true, name: true, timezone: true, slug: true },
    }),
    prisma.stallLocation.findMany({
      where: { organizationId, stallId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    capabilities.eventSchedule
      ? prisma.marketEvent.findMany({
          where: { organizationId, endsAt: { gte: new Date(Date.now() - 86_400_000) } },
          orderBy: { startsAt: "asc" },
          take: 200,
        })
      : Promise.resolve([]),
    prisma.stallSchedule.findMany({
      where: { organizationId, stallId },
      include: { location: true, marketEvent: true },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
      take: 365,
    }),
    prisma.qrCode.findMany({
      where: { organizationId, stallId, state: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: [{ diningTableId: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        state: true,
        diningTableId: true,
        stallScheduleId: true,
        fulfillmentTypeContext: true,
      },
    }),
  ]);
  if (!stall) throw new StallScheduleOperationError("STALL_NOT_FOUND");
  return {
    stall,
    capabilities,
    locations: locations.map(serializeLocation),
    events: events.map(serializeEvent),
    schedules: schedules.map(serializeSchedule),
    qrCodes,
  };
}

export async function applyStallScheduleCommand(input: {
  organizationId: string;
  stallId: string;
  command: StallScheduleCommand;
}) {
  const capabilities = await getScheduleCapabilities(input.organizationId);
  const { command } = input;
  let qrTokenToInvalidate: string | null = null;

  const result = await prisma.$transaction(async (transaction) => {
    if (command.operation === "CREATE") {
      await assertScheduleReferences(transaction, input, command, capabilities);
      await assertScheduleLimit(transaction, input, capabilities, 1);
      return transaction.stallSchedule.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          ...scheduleValues(command),
        },
      });
    }

    if (command.operation === "ASSIGN_QR_CONTEXT") {
      const qrCode = await transaction.qrCode.findFirst({
        where: { id: command.qrCodeId, organizationId: input.organizationId, stallId: input.stallId },
        select: { id: true, token: true, diningTableId: true },
      });
      if (!qrCode) throw new StallScheduleOperationError("QR_CODE_NOT_FOUND");
      const schedule = command.scheduleId
        ? await transaction.stallSchedule.findFirst({
            where: { id: command.scheduleId, organizationId: input.organizationId, stallId: input.stallId },
          })
        : null;
      if (command.scheduleId && !schedule) throw new StallScheduleOperationError("SCHEDULE_NOT_FOUND");
      const fulfillmentType = normalizeQrFulfillmentType(
        qrCode.diningTableId,
        command.fulfillmentType,
      );
      if (fulfillmentType === "DELIVERY") {
        const settings = await transaction.stallOrderingSettings.findFirst({
          where: { organizationId: input.organizationId, stallId: input.stallId },
          select: { deliveryModuleEnabled: true },
        });
        if (!settings?.deliveryModuleEnabled) {
          throw new StallScheduleOperationError("DELIVERY_MODULE_REQUIRED");
        }
      }
      qrTokenToInvalidate = qrCode.token;
      await transaction.orderSession.updateMany({
        where: { qrCodeId: qrCode.id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      return transaction.qrCode.update({
        where: { id: qrCode.id },
        data: {
          locationId: schedule?.locationId ?? null,
          marketEventId: schedule?.marketEventId ?? null,
          stallScheduleId: schedule?.id ?? null,
          fulfillmentTypeContext: schedule ? fulfillmentType : (qrCode.diningTableId ? "DINE_IN" : null),
        },
      });
    }

    const existing = await transaction.stallSchedule.findFirst({
      where: {
        id: command.scheduleId,
        organizationId: input.organizationId,
        stallId: input.stallId,
      },
    });
    if (!existing) throw new StallScheduleOperationError("SCHEDULE_NOT_FOUND");

    if (command.operation === "UPDATE") {
      if (!["SCHEDULED", "DELAYED"].includes(existing.status)) {
        throw new StallScheduleOperationError("SCHEDULE_TRANSITION_DENIED");
      }
      await assertScheduleReferences(transaction, input, command, capabilities);
      return transaction.stallSchedule.update({
        where: { id: existing.id },
        data: scheduleValues(command),
      });
    }

    if (command.operation === "DELETE") {
      if (!["SCHEDULED", "CANCELLED"].includes(existing.status)) {
        throw new StallScheduleOperationError("SCHEDULE_IN_USE");
      }
      const references = await Promise.all([
        transaction.qrCode.count({ where: { stallScheduleId: existing.id } }),
        transaction.order.count({ where: { stallScheduleId: existing.id } }),
      ]);
      if (references.some((count) => count > 0)) throw new StallScheduleOperationError("SCHEDULE_IN_USE");
      return transaction.stallSchedule.delete({ where: { id: existing.id } });
    }

    if (command.operation === "COPY_WEEKLY") {
      if (!capabilities.recurringCopy) throw new StallScheduleOperationError("RECURRING_COPY_REQUIRED");
      if (existing.marketEventId) throw new StallScheduleOperationError("EVENT_SCHEDULE_NOT_COPYABLE");
      await assertScheduleLimit(transaction, input, capabilities, command.weeks);
      const copies = [];
      for (let week = 1; week <= command.weeks; week += 1) {
        const offset = week * 7 * 86_400_000;
        copies.push(await transaction.stallSchedule.create({
          data: {
            organizationId: input.organizationId,
            stallId: input.stallId,
            locationId: existing.locationId,
            marketEventId: null,
            startsAt: new Date(existing.startsAt.getTime() + offset),
            endsAt: new Date(existing.endsAt.getTime() + offset),
            orderingOpensAt: existing.orderingOpensAt
              ? new Date(existing.orderingOpensAt.getTime() + offset)
              : null,
            orderingClosesAt: existing.orderingClosesAt
              ? new Date(existing.orderingClosesAt.getTime() + offset)
              : null,
            specialNotice: existing.specialNotice,
            menuOverrideId: existing.menuOverrideId,
            autoOpenEnabled: existing.autoOpenEnabled,
            autoCloseEnabled: existing.autoCloseEnabled,
          },
        }));
      }
      return copies;
    }

    if (!canTransitionSchedule(existing.status, command.status)) {
      throw new StallScheduleOperationError("SCHEDULE_TRANSITION_DENIED");
    }
    const updated = await transaction.stallSchedule.update({
      where: { id: existing.id },
      data: { status: command.status, specialNotice: command.specialNotice },
    });
    await applyManualOrderingTransition(transaction, updated, existing.status, command.status);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  invalidatePublicMenu(input.stallId);
  if (qrTokenToInvalidate) invalidatePublicQrToken(qrTokenToInvalidate);
  return result;
}

export async function getPublicStallSchedule(stallSlug: string, now = new Date()) {
  const stall = await prisma.stall.findFirst({
    where: {
      slug: stallSlug,
      isActive: true,
      organization: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      slug: true,
      timezone: true,
      logoUrl: true,
      businessStatus: true,
      orderingState: true,
    },
  });
  if (!stall) return null;
  try {
    await entitlementService.assertFeatureEnabled(stall.organizationId, "STALL_SCHEDULE");
  } catch (error) {
    if (error instanceof EntitlementError) return null;
    throw error;
  }
  const schedules = await prisma.stallSchedule.findMany({
    where: {
      organizationId: stall.organizationId,
      stallId: stall.id,
      status: { in: ["SCHEDULED", "OPEN", "DELAYED", "COMPLETED"] },
      endsAt: { gte: new Date(now.getTime() - 36 * 60 * 60_000) },
      startsAt: { lte: new Date(now.getTime() + 90 * 24 * 60 * 60_000) },
    },
    include: { location: true, marketEvent: true },
    orderBy: { startsAt: "asc" },
    take: 100,
  });
  return {
    stall: {
      name: stall.name,
      slug: stall.slug,
      timezone: stall.timezone,
      logoUrl: stall.logoUrl,
      businessStatus: stall.businessStatus,
      orderingState: stall.orderingState,
    },
    generatedAt: now.toISOString(),
    schedules: schedules.map((schedule) => ({
      startsAt: schedule.startsAt.toISOString(),
      endsAt: schedule.endsAt.toISOString(),
      orderingOpensAt: schedule.orderingOpensAt?.toISOString() ?? null,
      orderingClosesAt: schedule.orderingClosesAt?.toISOString() ?? null,
      status: schedule.status,
      specialNotice: schedule.specialNotice,
      location: schedule.location && schedule.location.isActive ? {
        name: schedule.location.name,
        address: schedule.location.address,
        latitude: schedule.location.latitude !== null ? Number(schedule.location.latitude) : null,
        longitude: schedule.location.longitude !== null ? Number(schedule.location.longitude) : null,
        mapUrl: schedule.location.mapUrl,
        instructions: schedule.location.instructions,
      } : null,
      event: schedule.marketEvent?.isPublic ? {
        name: schedule.marketEvent.name,
        slug: schedule.marketEvent.slug,
        venueName: schedule.marketEvent.venueName,
        address: schedule.marketEvent.address,
        publicUrl: schedule.marketEvent.publicUrl,
        organizer: schedule.marketEvent.organizer,
      } : null,
    })),
  };
}

export function stallScheduleErrorMessage(error: StallScheduleOperationError) {
  const messages: Record<StallScheduleOperationError["code"], string> = {
    STALL_NOT_FOUND: "找不到此攤位。",
    LOCATION_NOT_FOUND: "找不到此出攤地點。",
    LOCATION_LIMIT_REACHED: "已達目前方案的地點數量上限。",
    LOCATION_IN_USE: "此地點已有行程、QR 或訂單紀錄，請改為停用。",
    EVENT_NOT_FOUND: "找不到此市集活動。",
    EVENT_FEATURE_REQUIRED: "目前方案未包含市集活動行程。",
    EVENT_IN_USE: "此活動已有行程、QR 或訂單紀錄，無法刪除。",
    SCHEDULE_NOT_FOUND: "找不到此出攤行程。",
    SCHEDULE_LIMIT_REACHED: "已達目前方案的行程數量上限。",
    SCHEDULE_IN_USE: "此行程已啟用或已有關聯紀錄，無法刪除。",
    SCHEDULE_TRANSITION_DENIED: "目前行程狀態不允許此操作。",
    SCHEDULE_CONTEXT_INVALID: "行程地點或活動範圍不正確。",
    SCHEDULE_EVENT_WINDOW_INVALID: "行程時間超出活動可接受範圍。",
    RECURRING_COPY_REQUIRED: "目前方案未包含週期行程複製。",
    EVENT_SCHEDULE_NOT_COPYABLE: "活動行程不能直接週期複製，請建立新的活動行程。",
    AUTOMATIC_ORDERING_REQUIRED: "目前方案未包含自動開放與停止接單。",
    QR_CODE_NOT_FOUND: "找不到此 QR Code。",
    QR_ORDER_TYPE_INVALID: "QR Code 與點餐類型不相符。",
    DELIVERY_MODULE_REQUIRED: "請先啟用線上外送模組。",
  };
  return messages[error.code];
}

export function scheduleAuditAction(command: StallScheduleCommand) {
  const actions: Record<StallScheduleCommand["operation"], string> = {
    CREATE: "STALL_SCHEDULE_CREATED",
    UPDATE: "STALL_SCHEDULE_UPDATED",
    DELETE: "STALL_SCHEDULE_DELETED",
    COPY_WEEKLY: "STALL_SCHEDULE_COPIED",
    SET_STATUS: "STALL_SCHEDULE_STATUS_CHANGED",
    ASSIGN_QR_CONTEXT: "QR_SCHEDULE_CONTEXT_CHANGED",
  };
  return actions[command.operation];
}

export async function invalidateStallSchedulePublicData(
  organizationId: string,
  stallId: string,
) {
  invalidatePublicMenu(stallId);
  const qrCodes = await prisma.qrCode.findMany({
    where: { organizationId, stallId },
    select: { token: true },
  });
  for (const qrCode of qrCodes) invalidatePublicQrToken(qrCode.token);
}

export async function invalidateOrganizationSchedulePublicData(organizationId: string) {
  await invalidateOrganizationPublicMenus(organizationId);
  const qrCodes = await prisma.qrCode.findMany({
    where: { organizationId },
    select: { token: true },
  });
  for (const qrCode of qrCodes) invalidatePublicQrToken(qrCode.token);
}

async function getScheduleCapabilities(organizationId: string): Promise<ScheduleCapabilities> {
  const [location, schedule, entitlements] = await Promise.all([
    entitlementService.assertFeatureEnabled(organizationId, "STALL_LOCATION"),
    entitlementService.assertFeatureEnabled(organizationId, "STALL_SCHEDULE"),
    entitlementService.getEffectiveEntitlements(organizationId),
  ]);
  const locationConfiguration = jsonObject(location.configuration);
  const scheduleConfiguration = jsonObject(schedule.configuration);
  const effectiveLocation = entitlements.find((entry) => entry.featureCode === "STALL_LOCATION");
  const effectiveSchedule = entitlements.find((entry) => entry.featureCode === "STALL_SCHEDULE");
  return {
    locationLimit: effectiveLocation?.limitValue ?? null,
    scheduleLimit: effectiveSchedule?.limitValue ?? null,
    multipleLocations: locationConfiguration.multipleLocations === true,
    recurringCopy: scheduleConfiguration.recurringCopy === true,
    automaticOrdering: scheduleConfiguration.automaticOrdering === true,
    eventSchedule: scheduleConfiguration.eventSchedule === true,
  };
}

function jsonObject(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function locationValues(command: Extract<StallLocationCommand, { operation: "CREATE" | "UPDATE" }>) {
  return {
    name: command.name,
    address: command.address,
    latitude: command.latitude,
    longitude: command.longitude,
    mapUrl: command.mapUrl,
    instructions: command.instructions,
    isActive: command.isActive,
  };
}

function eventValues(command: Extract<MarketEventCommand, { operation: "CREATE" | "UPDATE" }>) {
  return {
    name: command.name,
    slug: command.slug,
    description: command.description,
    venueName: command.venueName,
    address: command.address,
    latitude: command.latitude,
    longitude: command.longitude,
    startsAt: new Date(command.startsAt),
    endsAt: new Date(command.endsAt),
    organizer: command.organizer,
    publicUrl: command.publicUrl,
    isPublic: command.isPublic,
  };
}

function scheduleValues(command: Extract<StallScheduleCommand, { operation: "CREATE" | "UPDATE" }>) {
  return {
    locationId: command.locationId,
    marketEventId: command.marketEventId,
    startsAt: new Date(command.startsAt),
    endsAt: new Date(command.endsAt),
    orderingOpensAt: command.orderingOpensAt ? new Date(command.orderingOpensAt) : null,
    orderingClosesAt: command.orderingClosesAt ? new Date(command.orderingClosesAt) : null,
    specialNotice: command.specialNotice,
    menuOverrideId: command.menuOverrideId,
    autoOpenEnabled: command.autoOpenEnabled,
    autoCloseEnabled: command.autoCloseEnabled,
  };
}

async function assertScheduleReferences(
  transaction: Prisma.TransactionClient,
  scope: { organizationId: string; stallId: string },
  command: Extract<StallScheduleCommand, { operation: "CREATE" | "UPDATE" }>,
  capabilities: ScheduleCapabilities,
) {
  if ((command.autoOpenEnabled || command.autoCloseEnabled) && !capabilities.automaticOrdering) {
    throw new StallScheduleOperationError("AUTOMATIC_ORDERING_REQUIRED");
  }
  const [location, event] = await Promise.all([
    command.locationId
      ? transaction.stallLocation.findFirst({
          where: { id: command.locationId, organizationId: scope.organizationId, stallId: scope.stallId, isActive: true },
        })
      : Promise.resolve(null),
    command.marketEventId
      ? transaction.marketEvent.findFirst({
          where: { id: command.marketEventId, organizationId: scope.organizationId },
        })
      : Promise.resolve(null),
  ]);
  if (command.locationId && !location) throw new StallScheduleOperationError("SCHEDULE_CONTEXT_INVALID");
  if (command.marketEventId) {
    if (!capabilities.eventSchedule) throw new StallScheduleOperationError("EVENT_FEATURE_REQUIRED");
    if (!event) throw new StallScheduleOperationError("SCHEDULE_CONTEXT_INVALID");
    const startsAt = Date.parse(command.startsAt);
    const endsAt = Date.parse(command.endsAt);
    const tolerance = 30 * 24 * 60 * 60_000;
    if (startsAt < event.startsAt.getTime() - tolerance || endsAt > event.endsAt.getTime() + tolerance) {
      throw new StallScheduleOperationError("SCHEDULE_EVENT_WINDOW_INVALID");
    }
  }
}

async function assertScheduleLimit(
  transaction: Prisma.TransactionClient,
  scope: { organizationId: string; stallId: string },
  capabilities: ScheduleCapabilities,
  additional: number,
) {
  if (capabilities.scheduleLimit === null) return;
  const count = await transaction.stallSchedule.count({
    where: {
      organizationId: scope.organizationId,
      stallId: scope.stallId,
      status: { in: ["SCHEDULED", "OPEN", "DELAYED"] },
    },
  });
  if (count + additional > capabilities.scheduleLimit) {
    throw new StallScheduleOperationError("SCHEDULE_LIMIT_REACHED");
  }
}

function normalizeQrFulfillmentType(
  diningTableId: string | null,
  requested: FulfillmentType | null,
): FulfillmentType {
  if (diningTableId) {
    if (requested && requested !== "DINE_IN") {
      throw new StallScheduleOperationError("QR_ORDER_TYPE_INVALID");
    }
    return "DINE_IN";
  }
  if (requested === "DINE_IN") throw new StallScheduleOperationError("QR_ORDER_TYPE_INVALID");
  return requested ?? "TAKEOUT";
}

async function applyManualOrderingTransition(
  transaction: Prisma.TransactionClient,
  schedule: { id: string; organizationId: string; stallId: string },
  previousStatus: StallScheduleStatus,
  nextStatus: StallScheduleStatus,
) {
  if (nextStatus === "OPEN") {
    const stall = await transaction.stall.findFirst({
      where: { id: schedule.stallId, organizationId: schedule.organizationId },
      select: {
        id: true,
        isActive: true,
        isSoldOut: true,
        capacitySettings: { select: { pauseSource: true } },
      },
    });
    if (stall?.isActive && !stall.isSoldOut
        && (!stall.capacitySettings || stall.capacitySettings.pauseSource === "NONE")) {
      await transaction.stall.update({
        where: { id: stall.id },
        data: {
          businessStatus: "OPEN",
          orderingEnabled: true,
          orderingState: "OPEN",
        },
      });
    }
    return;
  }
  if (previousStatus !== "OPEN" || !["COMPLETED", "CANCELLED"].includes(nextStatus)) return;
  const otherOpen = await transaction.stallSchedule.count({
    where: { stallId: schedule.stallId, id: { not: schedule.id }, status: "OPEN" },
  });
  if (otherOpen > 0) return;
  await transaction.stall.update({
    where: { id: schedule.stallId },
    data: { orderingState: "CLOSED" },
  });
  await transaction.orderSession.updateMany({
    where: { stallId: schedule.stallId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}

function serializeLocation(location: {
  id: string;
  name: string;
  address: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  mapUrl: string | null;
  instructions: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...location,
    latitude: location.latitude !== null ? Number(location.latitude) : null,
    longitude: location.longitude !== null ? Number(location.longitude) : null,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

function serializeEvent(event: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  venueName: string;
  address: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  startsAt: Date;
  endsAt: Date;
  organizer: string | null;
  publicUrl: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...event,
    latitude: event.latitude !== null ? Number(event.latitude) : null,
    longitude: event.longitude !== null ? Number(event.longitude) : null,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

function serializeSchedule(schedule: Awaited<ReturnType<typeof prisma.stallSchedule.findFirstOrThrow>> & {
  location?: Parameters<typeof serializeLocation>[0] | null;
  marketEvent?: Parameters<typeof serializeEvent>[0] | null;
}) {
  return {
    id: schedule.id,
    locationId: schedule.locationId,
    marketEventId: schedule.marketEventId,
    startsAt: schedule.startsAt.toISOString(),
    endsAt: schedule.endsAt.toISOString(),
    orderingOpensAt: schedule.orderingOpensAt?.toISOString() ?? null,
    orderingClosesAt: schedule.orderingClosesAt?.toISOString() ?? null,
    status: schedule.status,
    specialNotice: schedule.specialNotice,
    menuOverrideId: schedule.menuOverrideId,
    autoOpenEnabled: schedule.autoOpenEnabled,
    autoCloseEnabled: schedule.autoCloseEnabled,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
    location: schedule.location ? serializeLocation(schedule.location) : null,
    marketEvent: schedule.marketEvent ? serializeEvent(schedule.marketEvent) : null,
  };
}
