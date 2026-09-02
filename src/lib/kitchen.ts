import "server-only";

import { Prisma, type OrderItemStatus, type OrderStatus } from "@prisma/client";
import {
  canTransitionKitchenTask,
  partitionKitchenTasksByFulfillmentDate,
  preserveKitchenOrderProgress,
  type KitchenBoardMode,
  type KitchenBoardTask,
  type KitchenOperationalOrderStatus,
} from "@/lib/kitchen-contract";
import { classifyStallOrderForProduction } from "@/lib/fulfillment-time";
import { kitchenAlertOrderStatuses } from "@/lib/kitchen-order-alerts";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/server/billing/entitlement-service";
import { persistExternalOrderTransitionForOrder } from "@/server/delivery-platforms/external-order-status-service";

export class KitchenOperationError extends Error {
  constructor(public readonly code:
    | "TASK_NOT_FOUND"
    | "TASK_TRANSITION_INVALID"
    | "ORDER_NOT_ACTIVE"
    | "PRODUCTION_NOT_DUE"
    | "STATION_NOT_FOUND"
    | "STATION_IN_USE"
    | "DEFAULT_STATION_REQUIRED"
    | "STATION_CODE_CONFLICT"
    | "ASSIGNMENT_TARGET_INVALID"
    | "ASSIGNMENT_CONFLICT"
    | "STATION_LIMIT_REACHED") {
    super(code);
  }
}

const activeKitchenOrderStatuses: OrderStatus[] = ["CONFIRMED", "PREPARING", "PACKING", "READY"];

const kitchenTaskInclude = {
  station: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, displayName: true } },
  orderItem: {
    select: {
      id: true,
      name: true,
      quantity: true,
      note: true,
      noteOptions: {
        orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
        select: { optionName: true },
      },
    },
  },
  order: {
    select: {
      id: true,
      orderNo: true,
      pickupCodeDisplay: true,
      source: true,
      externalProvider: true,
      externalOrderNumber: true,
      scheduledPickupAt: true,
      requestedFulfillmentAt: true,
      committedFulfillmentAt: true,
      fulfillmentTimeState: true,
      riderPickupAt: true,
      fulfillmentType: true,
      tableLabel: true,
      note: true,
      status: true,
      createdAt: true,
      confirmedAt: true,
    },
  },
} satisfies Prisma.OrderProductionTaskInclude;

type KitchenTaskRecord = Prisma.OrderProductionTaskGetPayload<{ include: typeof kitchenTaskInclude }>;

export async function getKitchenBoardData(
  organizationId: string,
  stallId: string,
  stationId?: string,
) {
  const serverNow = new Date();
  const [, stallConfiguration, stations, tasks, alertOrders] = await Promise.all([
    prisma.$queryRaw`select public.refresh_kds_operational_alerts(
      ${organizationId}::uuid,
      ${stallId}::uuid
    )`,
    prisma.stall.findFirst({
      where: { organizationId, id: stallId },
      select: {
        timezone: true,
        orderingSettings: {
          select: {
            kdsWarningMinutes: true,
            kdsCriticalMinutes: true,
            kdsDefaultView: true,
            businessDayCutoffHour: true,
          },
        },
      },
    }),
    prisma.kitchenStation.findMany({
      where: {
        organizationId,
        stallId,
        OR: [
          { isActive: true },
          {
            productionTasks: {
              some: {
                status: { not: "CANCELLED" },
                order: { status: { in: activeKitchenOrderStatuses } },
              },
            },
          },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    prisma.orderProductionTask.findMany({
      where: {
        organizationId,
        stallId,
        status: { not: "CANCELLED" },
        order: { status: { in: activeKitchenOrderStatuses } },
        ...(stationId ? { stationId } : {}),
      },
      orderBy: [{ order: { createdAt: "asc" } }, { createdAt: "asc" }],
      include: kitchenTaskInclude,
    }),
    prisma.order.findMany({
      where: {
        organizationId,
        stallId,
        status: { in: [...kitchenAlertOrderStatuses] },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);
  const serializedTasks = tasks.map(serializeKitchenTask);
  const settings = stallConfiguration?.orderingSettings;
  const timeZone = stallConfiguration?.timezone ?? "Asia/Taipei";
  const partitioned = partitionKitchenTasksByFulfillmentDate(serializedTasks, {
    timeZone,
    businessDayCutoffHour: settings?.businessDayCutoffHour ?? 0,
    now: serverNow,
  });

  return {
    settings: {
      warningMinutes: settings?.kdsWarningMinutes ?? 5,
      criticalMinutes: settings?.kdsCriticalMinutes ?? 10,
      defaultView: normalizeDefaultView(settings?.kdsDefaultView),
      timeZone,
      businessDayCutoffHour: settings?.businessDayCutoffHour ?? 0,
    },
    stations,
    tasks: partitioned.currentTasks,
    futureReservations: partitioned.futureReservations,
    alertOrderIds: alertOrders.map((order) => order.id),
    serverNow: serverNow.toISOString(),
  };
}

export async function getKitchenSettings(organizationId: string, stallId: string) {
  const settings = await prisma.stallOrderingSettings.findFirstOrThrow({
    where: { organizationId, stallId },
    select: { kdsWarningMinutes: true, kdsCriticalMinutes: true, kdsDefaultView: true },
  });
  return {
    warningMinutes: settings.kdsWarningMinutes,
    criticalMinutes: settings.kdsCriticalMinutes,
    defaultView: normalizeDefaultView(settings.kdsDefaultView),
  };
}

export async function getKitchenStationConfiguration(organizationId: string, stallId: string) {
  const [stations, categories, products, entitlement] = await Promise.all([
    prisma.kitchenStation.findMany({
      where: { organizationId, stallId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        assignments: {
          orderBy: { createdAt: "asc" },
          include: {
            category: { select: { id: true, name: true } },
            product: { select: { id: true, name: true } },
          },
        },
        _count: { select: { productionTasks: true } },
      },
    }),
    prisma.productCategory.findMany({
      where: {
        organizationId,
        isActive: true,
        products: { some: { stallProducts: { some: { stallId, isEnabled: true } } } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        isActive: true,
        stallProducts: { some: { stallId, isEnabled: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, categoryId: true },
    }),
    entitlementService.assertFeatureEnabled(organizationId, "KDS"),
  ]);

  return {
    stations: stations.map((station) => ({
      id: station.id,
      name: station.name,
      code: station.code,
      description: station.description,
      sortOrder: station.sortOrder,
      isActive: station.isActive,
      taskCount: station._count.productionTasks,
      assignments: station.assignments.map((assignment) => ({
        id: assignment.id,
        category: assignment.category,
        product: assignment.product,
      })),
    })),
    categories,
    products,
    maxStations: entitlement.limitValue,
  };
}

export async function applyKitchenTaskUpdate(input: {
  organizationId: string;
  stallId: string;
  actorProfileId: string;
  taskId: string;
  status: "PENDING" | "PREPARING" | "COMPLETED";
}) {
  return prisma.$transaction(async (transaction) => {
    const taskOwner = await transaction.orderProductionTask.findFirst({
      where: { id: input.taskId, organizationId: input.organizationId, stallId: input.stallId },
      select: { orderId: true, orderItemId: true },
    });
    if (!taskOwner) throw new KitchenOperationError("TASK_NOT_FOUND");

    await transaction.$queryRaw`
      select id from public.orders
      where id = ${taskOwner.orderId}::uuid
        and organization_id = ${input.organizationId}::uuid
        and stall_id = ${input.stallId}::uuid
      for update
    `;
    await transaction.$queryRaw`
      select id from public.order_items
      where id = ${taskOwner.orderItemId}::uuid
        and order_id = ${taskOwner.orderId}::uuid
        and organization_id = ${input.organizationId}::uuid
        and stall_id = ${input.stallId}::uuid
      for update
    `;
    await transaction.$queryRaw`
      select id from public.order_production_tasks
      where id = ${input.taskId}::uuid
        and order_id = ${taskOwner.orderId}::uuid
        and organization_id = ${input.organizationId}::uuid
        and stall_id = ${input.stallId}::uuid
      for update
    `;
    const task = await transaction.orderProductionTask.findFirst({
      where: { id: input.taskId, organizationId: input.organizationId, stallId: input.stallId },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            organizationId: true,
            stallId: true,
            scheduledPickupAt: true,
            requestedFulfillmentAt: true,
            committedFulfillmentAt: true,
            fulfillmentTimeState: true,
            stall: {
              select: {
                timezone: true,
                orderingSettings: { select: { businessDayCutoffHour: true } },
              },
            },
          },
        },
        orderItem: { select: { id: true, status: true } },
      },
    });
    if (!task) throw new KitchenOperationError("TASK_NOT_FOUND");
    if (!activeKitchenOrderStatuses.includes(task.order.status)) {
      throw new KitchenOperationError("ORDER_NOT_ACTIVE");
    }
    if (task.order.status === "READY") {
      throw new KitchenOperationError("TASK_TRANSITION_INVALID");
    }
    if (!canTransitionKitchenTask(task.status, input.status)) {
      throw new KitchenOperationError("TASK_TRANSITION_INVALID");
    }
    if (input.status === "PREPARING"
      && task.order.status === "CONFIRMED"
      && classifyStallOrderForProduction(task.order).productionBlocked) {
      throw new KitchenOperationError("PRODUCTION_NOT_DUE");
    }
    if (task.orderItem.status === "SERVED") {
      throw new KitchenOperationError("TASK_TRANSITION_INVALID");
    }

    const now = new Date();
    const nextItemStatus = taskStateToItemState(input.status);
    await transaction.orderItem.update({
      where: { id: task.orderItemId },
      data: {
        status: nextItemStatus,
        preparingAt: nextItemStatus === "PENDING" ? null : task.orderItem.status === "PENDING" ? now : undefined,
        readyAt: nextItemStatus === "READY" ? now : null,
        servedAt: null,
      },
    });
    await transaction.orderProductionTask.update({
      where: { id: task.id },
      data: {
        assignedToProfileId: input.status === "PENDING" ? null : input.actorProfileId,
      },
    });

    const derivedOrderStatus = await deriveKitchenOrderStatus(transaction, task.orderId);
    const nextOrderStatus = preserveKitchenOrderProgress(
      task.order.status as KitchenOperationalOrderStatus,
      derivedOrderStatus,
    );
    if (nextOrderStatus !== task.order.status) {
      await transaction.order.update({ where: { id: task.orderId }, data: { status: nextOrderStatus } });
      await persistExternalOrderTransitionForOrder(
        transaction,
        task.orderId,
        nextOrderStatus,
      );
    }
    await transaction.orderEvent.create({
      data: {
        organizationId: task.order.organizationId,
        stallId: task.order.stallId,
        orderId: task.order.id,
        eventType: input.status === "PENDING" ? "PRODUCTION_TASK_RETURNED" : "PRODUCTION_TASK_UPDATED",
        previousStatus: task.order.status,
        newStatus: nextOrderStatus,
        createdBy: input.actorProfileId,
      },
    });
    return { orderId: task.orderId, previousTaskStatus: task.status, nextTaskStatus: input.status };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function completeKitchenOrder(input: {
  organizationId: string;
  stallId: string;
  actorProfileId: string;
  orderId: string;
}) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id from public.orders
      where id = ${input.orderId}::uuid
        and organization_id = ${input.organizationId}::uuid
        and stall_id = ${input.stallId}::uuid
      for update
    `;
    const order = await transaction.order.findFirst({
      where: { id: input.orderId, organizationId: input.organizationId, stallId: input.stallId },
      select: {
        id: true,
        status: true,
        scheduledPickupAt: true,
        requestedFulfillmentAt: true,
        committedFulfillmentAt: true,
        fulfillmentTimeState: true,
        stall: {
          select: {
            timezone: true,
            orderingSettings: { select: { businessDayCutoffHour: true } },
          },
        },
        items: { select: { id: true, status: true } },
        productionTasks: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
      },
    });
    if (!order) throw new KitchenOperationError("TASK_NOT_FOUND");
    if (order.status === "CONFIRMED"
      && classifyStallOrderForProduction(order).productionBlocked) {
      throw new KitchenOperationError("PRODUCTION_NOT_DUE");
    }
    if (!["CONFIRMED", "PREPARING", "PACKING"].includes(order.status)) {
      throw new KitchenOperationError("ORDER_NOT_ACTIVE");
    }
    if (order.productionTasks.length === 0 || order.items.some((item) => item.status === "SERVED")) {
      throw new KitchenOperationError("TASK_TRANSITION_INVALID");
    }

    const now = new Date();
    await transaction.orderItem.updateMany({
      where: { orderId: order.id, stallId: input.stallId, status: "PENDING" },
      data: { status: "READY", preparingAt: now, readyAt: now },
    });
    await transaction.orderItem.updateMany({
      where: { orderId: order.id, stallId: input.stallId, status: "PREPARING" },
      data: { status: "READY", readyAt: now },
    });
    await transaction.orderProductionTask.updateMany({
      where: { orderId: order.id, stallId: input.stallId, status: { not: "CANCELLED" } },
      data: { assignedToProfileId: input.actorProfileId },
    });
    await transaction.order.update({ where: { id: order.id }, data: { status: "READY" } });
    await persistExternalOrderTransitionForOrder(transaction, order.id, "READY");
    await transaction.orderEvent.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        orderId: order.id,
        eventType: "PRODUCTION_ORDER_COMPLETED",
        previousStatus: order.status,
        newStatus: "READY",
        createdBy: input.actorProfileId,
      },
    });
    return {
      orderId: order.id,
      previousOrderStatus: order.status,
      completedTaskCount: order.productionTasks.length,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function applyKitchenStationCommand(
  organizationId: string,
  stallId: string,
  command:
    | { operation: "CREATE_STATION"; name: string; code: string; description?: string | null; sortOrder: number; isActive: boolean }
    | { operation: "UPDATE_STATION"; stationId: string; name: string; code: string; description?: string | null; sortOrder: number; isActive: boolean }
    | { operation: "DELETE_STATION"; stationId: string }
    | { operation: "CREATE_ASSIGNMENT"; stationId: string; categoryId: string | null; productId: string | null }
    | { operation: "DELETE_ASSIGNMENT"; assignmentId: string },
) {
  try {
    if (command.operation === "CREATE_STATION") {
      const entitlement = await entitlementService.assertFeatureEnabled(organizationId, "KDS");
      const currentCount = await prisma.kitchenStation.count({ where: { organizationId, stallId } });
      if (entitlement.limitValue !== null && currentCount >= entitlement.limitValue) {
        throw new KitchenOperationError("STATION_LIMIT_REACHED");
      }
      return prisma.kitchenStation.create({
        data: { organizationId, stallId, ...stationValues(command) },
      });
    }
    if (command.operation === "UPDATE_STATION") {
      const current = await requireStation(organizationId, stallId, command.stationId);
      if (current.code === "DEFAULT" && command.code !== "DEFAULT") {
        throw new KitchenOperationError("DEFAULT_STATION_REQUIRED");
      }
      return prisma.kitchenStation.update({
        where: { id: current.id },
        data: stationValues(command),
      });
    }
    if (command.operation === "DELETE_STATION") {
      const current = await requireStation(organizationId, stallId, command.stationId);
      if (current.code === "DEFAULT") throw new KitchenOperationError("DEFAULT_STATION_REQUIRED");
      const taskCount = await prisma.orderProductionTask.count({ where: { stationId: current.id } });
      if (taskCount > 0) throw new KitchenOperationError("STATION_IN_USE");
      return prisma.kitchenStation.delete({ where: { id: current.id } });
    }
    if (command.operation === "CREATE_ASSIGNMENT") {
      await requireStation(organizationId, stallId, command.stationId);
      if (command.productId) {
        const product = await prisma.stallProduct.findFirst({
          where: {
            organizationId,
            stallId,
            productId: command.productId,
            isEnabled: true,
            product: { isActive: true },
          },
          select: { id: true },
        });
        if (!product) throw new KitchenOperationError("ASSIGNMENT_TARGET_INVALID");
      } else if (command.categoryId) {
        const category = await prisma.productCategory.findFirst({
          where: {
            id: command.categoryId,
            organizationId,
            products: {
              some: {
                isActive: true,
                stallProducts: { some: { stallId, isEnabled: true } },
              },
            },
          },
          select: { id: true },
        });
        if (!category) throw new KitchenOperationError("ASSIGNMENT_TARGET_INVALID");
      } else {
        throw new KitchenOperationError("ASSIGNMENT_TARGET_INVALID");
      }
      return prisma.kitchenStationAssignment.create({
        data: {
          organizationId,
          stallId,
          stationId: command.stationId,
          categoryId: command.categoryId,
          productId: command.productId,
        },
      });
    }

    const assignment = await prisma.kitchenStationAssignment.findFirst({
      where: { id: command.assignmentId, organizationId, stallId },
      select: { id: true },
    });
    if (!assignment) throw new KitchenOperationError("ASSIGNMENT_TARGET_INVALID");
    return prisma.kitchenStationAssignment.delete({ where: { id: assignment.id } });
  } catch (error) {
    if (error instanceof KitchenOperationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (command.operation === "CREATE_STATION" || command.operation === "UPDATE_STATION") {
        throw new KitchenOperationError("STATION_CODE_CONFLICT");
      }
      throw new KitchenOperationError("ASSIGNMENT_CONFLICT");
    }
    throw error;
  }
}

export async function updateKitchenSettings(
  organizationId: string,
  stallId: string,
  settings: { warningMinutes: number; criticalMinutes: number; defaultView: string },
) {
  const result = await prisma.stallOrderingSettings.updateMany({
    where: { organizationId, stallId },
    data: {
      kdsWarningMinutes: settings.warningMinutes,
      kdsCriticalMinutes: settings.criticalMinutes,
      kdsDefaultView: settings.defaultView,
    },
  });
  if (result.count !== 1) throw new KitchenOperationError("STATION_NOT_FOUND");
  return settings;
}

function serializeKitchenTask(task: KitchenTaskRecord): KitchenBoardTask {
  return {
    id: task.id,
    orderId: task.orderId,
    orderItemId: task.orderItemId,
    orderNo: task.order.orderNo,
    pickupCode: task.order.pickupCodeDisplay,
    source: task.order.source,
    externalProvider: task.order.externalProvider,
    externalOrderNumber: task.order.externalOrderNumber,
    scheduledPickupAt: task.order.scheduledPickupAt?.toISOString() ?? null,
    requestedFulfillmentAt: task.order.requestedFulfillmentAt?.toISOString() ?? null,
    committedFulfillmentAt: task.order.committedFulfillmentAt?.toISOString() ?? null,
    fulfillmentTimeState: task.order.fulfillmentTimeState,
    riderPickupAt: task.order.riderPickupAt?.toISOString() ?? null,
    fulfillmentType: task.order.fulfillmentType,
    tableLabel: task.order.tableLabel,
    orderNote: task.order.note,
    orderStatus: task.order.status as KitchenBoardTask["orderStatus"],
    orderCreatedAt: task.order.createdAt.toISOString(),
    confirmedAt: task.order.confirmedAt?.toISOString() ?? null,
    itemName: task.orderItem.name,
    quantity: task.quantity,
    itemNote: task.orderItem.note,
    modifiers: task.orderItem.noteOptions.map((option) => option.optionName),
    station: task.station,
    status: task.status,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    assignedTo: task.assignedTo,
  };
}

function taskStateToItemState(status: "PENDING" | "PREPARING" | "COMPLETED"): OrderItemStatus {
  if (status === "COMPLETED") return "READY";
  return status;
}

async function deriveKitchenOrderStatus(transaction: Prisma.TransactionClient, orderId: string) {
  const tasks = await transaction.orderProductionTask.findMany({
    where: { orderId, status: { not: "CANCELLED" } },
    select: { status: true, station: { select: { code: true } } },
  });
  if (tasks.length > 0 && tasks.every((task) => task.status === "COMPLETED")) return "READY" as const;
  const nonPackingComplete = tasks
    .filter((task) => task.station.code !== "PACKING")
    .every((task) => task.status === "COMPLETED");
  if (nonPackingComplete && tasks.some((task) => task.station.code === "PACKING" && task.status === "PREPARING")) {
    return "PACKING" as const;
  }
  if (tasks.some((task) => task.status !== "PENDING")) return "PREPARING" as const;
  return "CONFIRMED" as const;
}

async function requireStation(organizationId: string, stallId: string, stationId: string) {
  const station = await prisma.kitchenStation.findFirst({
    where: { id: stationId, organizationId, stallId },
    select: { id: true, code: true },
  });
  if (!station) throw new KitchenOperationError("STATION_NOT_FOUND");
  return station;
}

function stationValues(input: {
  name: string;
  code: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
}) {
  return {
    name: input.name,
    code: input.code,
    description: input.description ?? null,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
}

function normalizeDefaultView(value: string | undefined): KitchenBoardMode {
  return value === "ITEM" || value === "STATION" ? value : "ORDER";
}
