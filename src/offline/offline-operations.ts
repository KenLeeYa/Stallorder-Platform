"use client";

import { z } from "zod";
import type { PaymentOptionKind, UserRole } from "@prisma/client";
import { orderItemsExceedLimits } from "@/lib/order-item-limits";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import { createWebUuid } from "@/lib/web-uuid";
import { OFFLINE_APP_PROTOCOL_VERSION } from "@/offline/offline-contract";
import {
  canTransitionOfflineOrder,
  offlineCashEventSchema,
  offlineOrderEventSchema,
  offlineOrderSchema,
  offlinePaymentSchema,
  offlinePrintJobSchema,
  type OfflineCashEvent,
  type OfflineOrder,
  type OfflineOrderEvent,
  type OfflineOrderState,
  type OfflinePayment,
  type OfflinePaymentMethod,
  type OfflinePrintJob,
  type OfflineSyncRecord,
  type OfflineSyncResponse,
} from "@/offline/offline-order-contract";
import {
  openOfflineDatabase,
  requestResult,
  transactionComplete,
  withOfflineRecordMetadata,
} from "@/offline/offline-db";

const activePermitSchema = z.object({
  permit_id: z.string().uuid(),
  stall_id: z.string().uuid(),
  device_id: z.string().uuid(),
  token: z.string().min(64).max(4_096),
  roles: z.array(z.string()).max(20),
  allowed_offline_actions: z.array(z.string()).max(20),
  issued_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  menu_snapshot_version: z.number().int().min(1),
  promotion_epoch: z.string().regex(/^[1-9][0-9]*$/),
  storage_class: z.enum(["PERSISTENT", "BEST_EFFORT"]),
  app_protocol_version: z.literal(OFFLINE_APP_PROTOCOL_VERSION),
  risk_limits: z.object({
    maxOfflineDurationMinutes: z.number().int().min(15).max(720),
    maxPendingOrders: z.number().int().min(1).max(500),
    maxTotalAmount: z.number().min(0).max(100_000_000),
    maxSingleOrderAmount: z.number().min(0).max(100_000_000),
    maxManualPaymentAmount: z.number().int().min(0).max(100_000_000),
    maxTotalManualPaymentAmount: z.number().int().min(0).max(100_000_000),
    requireCustomerContactAboveAmount: z.number().int().min(0).max(100_000_000),
    managerApprovalThreshold: z.number().int().min(0).max(100_000_000),
  }).strict(),
}).passthrough();

const deviceProfileSchema = z.object({
  id: z.string().uuid(),
  installation_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  stall_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  offline_role: z.literal("OFFLINE_LEADER"),
  status: z.literal("ACTIVE"),
}).passthrough();

const noteOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  priceDelta: z.number().int().min(-100_000_000).max(100_000_000),
  sortOrder: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
}).passthrough();

const noteGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  selectionMode: z.enum(["SINGLE", "MULTIPLE"]),
  isRequired: z.boolean(),
  minSelections: z.number().int().min(0).max(50),
  maxSelections: z.number().int().min(0).max(50).nullable(),
  sortOrder: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
  options: z.array(noteOptionSchema).max(100),
}).passthrough();

const menuCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  stall: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(80),
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1).max(100),
  }).passthrough(),
  limits: z.object({
    maxItemQuantity: z.number().int().min(1).max(100),
    maxUniqueProducts: z.number().int().min(1).max(100),
    maxTotalQuantity: z.number().int().min(1).max(1_000),
    maxNoteLength: z.number().int().min(0).max(1_000),
  }).strict(),
  modules: z.object({
    print: z.boolean(),
    payment: z.boolean(),
  }).strict(),
  categories: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
  }).passthrough()).max(1_000),
  products: z.array(z.object({
    id: z.string().uuid(),
    categoryId: z.string().uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(1_000).nullable(),
    imageUrl: z.string().max(2_048).nullable(),
    price: z.number().int().min(0).max(100_000_000),
    isActive: z.boolean(),
    isEnabled: z.boolean(),
    isSoldOut: z.boolean(),
    availableFrom: z.string().datetime({ offset: true }).nullable(),
    availableUntil: z.string().datetime({ offset: true }).nullable(),
    noteGroups: z.array(noteGroupSchema).max(50),
  }).passthrough()).max(10_000),
  paymentOptions: z.array(z.object({
    id: z.string().uuid(),
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    kind: z.enum(["CASH", "LINE_PAY", "JKO_PAY", "CUSTOM"]),
  }).passthrough()).max(100),
}).passthrough();

const menuSnapshotSchema = z.object({
  version: z.number().int().min(1),
  id: z.string().uuid(),
  stall_id: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expires_at: z.string().datetime({ offset: true }),
  catalog: menuCatalogSchema,
}).passthrough();

const cashShiftSnapshotSchema = z.object({
  stall_id: z.string().uuid(),
  shift_id: z.string().uuid().nullable(),
  status: z.enum(["OPEN", "NONE", "PROVISIONAL_CLOSE"]),
  opening_amount: z.number().int().min(0).max(100_000_000).optional(),
  cash_sales: z.number().int().min(0).max(100_000_000).optional(),
  cash_in: z.number().int().min(0).max(100_000_000).optional(),
  cash_out: z.number().int().min(0).max(100_000_000).optional(),
  cash_refund: z.number().int().min(0).max(100_000_000).optional(),
  correction: z.number().int().min(-100_000_000).max(100_000_000).optional(),
  expected_amount: z.number().int().min(0).max(100_000_000).optional(),
  pending_events: z.array(z.unknown()).max(1_000),
}).passthrough();

type StoredOrder = Record<string, unknown> & {
  local_order_id: string;
  stall_id: string;
  sync_status: string;
  payload: OfflineOrder;
};

type StoredEvent = Record<string, unknown> & {
  event_id: string;
  local_order_id: string;
  payload: OfflineOrderEvent;
};

type StoredPayment = Record<string, unknown> & {
  local_payment_id: string;
  local_order_id: string;
  payload: OfflinePayment;
};

type StoredPrintJob = Record<string, unknown> & {
  print_job_id: string;
  local_order_id: string;
  deduplication_key: string;
  payload: OfflinePrintJob;
};

type StoredQueueRecord = Record<string, unknown> & {
  queue_id: string;
  idempotency_key: string;
  entity_type: "ORDER" | "CASH_EVENT";
  entity_id: string;
  stall_id: string;
  status: string;
  retry_count: number;
  next_attempt_at: string;
};

type StoredCashEvent = OfflineCashEvent & {
  sync_status: string;
  queue_id: string;
};

const UNSYNCHRONIZED = new Set(["PENDING", "PROCESSING", "FAILED", "CONFLICT", "REJECTED"]);
const MANAGER_ROLES = new Set([
  "PLATFORM_ADMIN",
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "STALL_MANAGER",
]);
const OFFLINE_ROLE_PRIORITY = [
  "PLATFORM_ADMIN",
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "MERCHANT_OWNER",
  "MERCHANT_MANAGER",
  "STALL_MANAGER",
  "STAFF",
  "KITCHEN",
] satisfies UserRole[];

function notifyOfflineDataChanged() {
  window.dispatchEvent(new CustomEvent("stallorder:offline-data-changed"));
}

export type CreateOfflineOrderDraft = {
  organizationId: string;
  stallId: string;
  idempotencyKey: string;
  customerLabel: string;
  customerContact: string;
  note: string;
  paymentTiming: "PAY_NOW" | "PAY_LATER";
  paymentOptionId: string | null;
  cashReceived: number | null;
  queuePrint: boolean;
  items: Array<{
    productId: string;
    quantity: number;
    note: string;
    noteOptionIds: string[];
  }>;
};

export type OfflineRecoveryWorkspace = {
  stall: {
    id: string;
    organizationId: string;
    slug: string;
    name: string;
    currency: string;
  };
  catalog: StaffOrderCatalog;
  account: { role: UserRole };
  modules: {
    dineIn: false;
    delivery: false;
    print: boolean;
    payment: boolean;
    discount: false;
    discountApprovalThresholdBps: number;
  };
  paymentOptions: Array<{
    id: string;
    name: string;
    kind: PaymentOptionKind;
  }>;
  permitExpiresAt: string;
  menuExpiresAt: string;
  storageClass: "PERSISTENT" | "BEST_EFFORT";
  canCreateOrder: boolean;
};

export class OfflineLocalOperationError extends Error {
  constructor(public readonly code:
    | "OFFLINE_BOOTSTRAP_REQUIRED"
    | "OFFLINE_PERMIT_EXPIRED"
    | "OFFLINE_MENU_EXPIRED"
    | "OFFLINE_DEVICE_NOT_LEADER"
    | "OFFLINE_SCOPE_MISMATCH"
    | "OFFLINE_ACTION_NOT_ALLOWED"
    | "OFFLINE_PRODUCT_UNAVAILABLE"
    | "OFFLINE_ITEM_LIMIT_EXCEEDED"
    | "OFFLINE_NOTE_SELECTION_INVALID"
    | "OFFLINE_RISK_LIMIT_REACHED"
    | "OFFLINE_PAYMENT_NOT_ALLOWED"
    | "OFFLINE_CASH_SHIFT_REQUIRED"
    | "OFFLINE_CUSTOMER_CONTACT_REQUIRED"
    | "OFFLINE_MANAGER_REQUIRED"
    | "OFFLINE_INVALID_STATE_TRANSITION"
    | "OFFLINE_RECORD_NOT_FOUND") {
    super(code);
    this.name = "OfflineLocalOperationError";
  }
}

function catalogProductAvailable(
  product: z.infer<typeof menuCatalogSchema>["products"][number],
  nowMs: number,
) {
  return product.isActive
    && product.isEnabled
    && !product.isSoldOut
    && (!product.availableFrom || Date.parse(product.availableFrom) <= nowMs)
    && (!product.availableUntil || Date.parse(product.availableUntil) > nowMs);
}

export async function getOfflineRecoveryWorkspaces(now = new Date()) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(
      ["device_profile", "offline_permit", "menu_snapshots"],
      "readonly",
    );
    const completion = transactionComplete(transaction);
    const [deviceRows, permitRows, menuRows] = await Promise.all([
      requestResult(transaction.objectStore("device_profile").getAll()),
      requestResult(transaction.objectStore("offline_permit").getAll()),
      requestResult(transaction.objectStore("menu_snapshots").getAll()),
    ]);
    await completion;

    const devices = validRecords(deviceProfileSchema, deviceRows as unknown[]);
    const permits = validRecords(activePermitSchema, permitRows as unknown[]);
    const menus = validRecords(menuSnapshotSchema, menuRows as unknown[]);
    const nowMs = now.getTime();

    return devices.flatMap((device): OfflineRecoveryWorkspace[] => {
      const permit = permits
        .filter((candidate) => (
          candidate.device_id === device.id
          && candidate.stall_id === device.stall_id
        ))
        .sort((left, right) => Date.parse(right.issued_at) - Date.parse(left.issued_at))[0];
      if (!permit) return [];
      const menu = menus.find((candidate) => (
        candidate.stall_id === device.stall_id
        && candidate.version === permit.menu_snapshot_version
      ));
      if (!menu) return [];

      const categoryNames = new Map(
        menu.catalog.categories.map((category) => [category.id, category.name]),
      );
      const roleSet = new Set(permit.roles);
      const role = OFFLINE_ROLE_PRIORITY.find((candidate) => roleSet.has(candidate))
        ?? "STAFF";
      const catalog: StaffOrderCatalog = {
        products: menu.catalog.products
          .filter((product) => catalogProductAvailable(product, nowMs))
          .map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description ?? "",
            category: categoryNames.get(product.categoryId) ?? "其他",
            price: product.price,
            imageUrl: product.imageUrl,
            isOrderDiscountEligible: true,
            noteGroups: product.noteGroups
              .filter((group) => group.isActive)
              .map((group) => ({
                id: group.id,
                name: group.name,
                selectionMode: group.selectionMode,
                isRequired: group.isRequired,
                minSelections: group.minSelections,
                maxSelections: group.maxSelections,
                options: group.options
                  .filter((option) => option.isActive)
                  .map((option) => ({
                    id: option.id,
                    name: option.name,
                    priceDelta: option.priceDelta,
                  })),
              })),
          })),
        tables: [],
        fulfillmentSlots: [],
        limits: menu.catalog.limits,
      };
      return [{
        stall: {
          id: device.stall_id,
          organizationId: device.organization_id,
          slug: menu.catalog.stall.slug,
          name: menu.catalog.stall.name,
          currency: menu.catalog.stall.currency,
        },
        catalog,
        account: { role },
        modules: {
          dineIn: false,
          delivery: false,
          print: menu.catalog.modules.print,
          payment: menu.catalog.modules.payment,
          discount: false,
          discountApprovalThresholdBps: 0,
        },
        paymentOptions: menu.catalog.paymentOptions.map((option) => ({
          id: option.id,
          name: option.name,
          kind: option.kind,
        })),
        permitExpiresAt: permit.expires_at,
        menuExpiresAt: menu.expires_at,
        storageClass: permit.storage_class,
        canCreateOrder: Date.parse(permit.expires_at) > nowMs
          && permit.allowed_offline_actions.includes("CREATE_OFFLINE_ORDER"),
      }];
    }).sort((left, right) => left.stall.name.localeCompare(right.stall.name, "zh-Hant"));
  } finally {
    database.close();
  }
}

function paymentMethodForKind(kind: "CASH" | "LINE_PAY" | "JKO_PAY" | "CUSTOM") {
  return ({
    CASH: "CASH",
    LINE_PAY: "MANUAL_LINE_PAY",
    JKO_PAY: "MANUAL_JKOPAY",
    CUSTOM: "OTHER_MANUAL",
  } as const)[kind];
}

function localBusinessDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

function deviceCode(deviceId: string) {
  return deviceId.replaceAll("-", "").slice(0, 6).toUpperCase();
}

function getSelectedNoteOptions(
  groups: z.infer<typeof noteGroupSchema>[],
  selectedIds: string[],
) {
  const selected = new Set(selectedIds);
  if (selected.size !== selectedIds.length) {
    throw new OfflineLocalOperationError("OFFLINE_NOTE_SELECTION_INVALID");
  }
  const allowed = new Set(
    groups.flatMap((group) => group.options.filter((option) => option.isActive).map((option) => option.id)),
  );
  if ([...selected].some((id) => !allowed.has(id))) {
    throw new OfflineLocalOperationError("OFFLINE_NOTE_SELECTION_INVALID");
  }
  return groups.flatMap((group, groupIndex) => {
    if (!group.isActive) return [];
    const options = group.options.filter((option) => option.isActive && selected.has(option.id));
    if (
      options.length < group.minSelections
      || (group.maxSelections !== null && options.length > group.maxSelections)
      || (group.selectionMode === "SINGLE" && options.length > 1)
      || (group.isRequired && options.length === 0)
    ) {
      throw new OfflineLocalOperationError("OFFLINE_NOTE_SELECTION_INVALID");
    }
    return options.map((option) => ({
      noteGroupId: group.id,
      noteOptionId: option.id,
      groupName: group.name,
      optionName: option.name,
      priceDelta: option.priceDelta,
      sortOrder: groupIndex * 1_000 + option.sortOrder,
    }));
  });
}

export function prepareOfflineOrderItemSnapshots(
  items: CreateOfflineOrderDraft["items"],
  catalog: Pick<z.infer<typeof menuCatalogSchema>, "products" | "limits">,
  now: Date,
) {
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  return items.map((item) => {
    const product = products.get(item.productId);
    if (
      !product
      || !product.isActive
      || !product.isEnabled
      || product.isSoldOut
      || (product.availableFrom && Date.parse(product.availableFrom) > now.getTime())
      || (product.availableUntil && Date.parse(product.availableUntil) <= now.getTime())
    ) {
      throw new OfflineLocalOperationError("OFFLINE_PRODUCT_UNAVAILABLE");
    }
    if (
      item.quantity < 1
      || item.quantity > catalog.limits.maxItemQuantity
      || item.note.length > catalog.limits.maxNoteLength
    ) {
      throw new OfflineLocalOperationError("OFFLINE_ITEM_LIMIT_EXCEEDED");
    }
    const noteOptions = getSelectedNoteOptions(product.noteGroups, item.noteOptionIds);
    const unitPrice = Math.max(
      0,
      product.price + noteOptions.reduce((sum, option) => sum + option.priceDelta, 0),
    );
    return {
      localItemId: createWebUuid(),
      productId: product.id,
      name: product.name,
      baseUnitPrice: product.price,
      unitPrice,
      quantity: item.quantity,
      note: item.note,
      noteOptions,
    };
  });
}

function parseRecord<T>(schema: z.ZodType<T>, value: unknown, code: OfflineLocalOperationError["code"]) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new OfflineLocalOperationError(code);
  return parsed.data;
}

function validRecords<T>(schema: z.ZodType<T>, values: unknown[]) {
  return values.flatMap((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

async function readBootstrap(
  transaction: IDBTransaction,
  organizationId: string,
  stallId: string,
  now: Date,
) {
  const [deviceRows, permitRows] = await Promise.all([
    requestResult(transaction.objectStore("device_profile").getAll()),
    requestResult(transaction.objectStore("offline_permit").getAll()),
  ]);
  const device = validRecords(deviceProfileSchema, deviceRows as unknown[])
    .find((record) => record.stall_id === stallId);
  if (!device) throw new OfflineLocalOperationError("OFFLINE_DEVICE_NOT_LEADER");
  if (device.organization_id !== organizationId) {
    throw new OfflineLocalOperationError("OFFLINE_SCOPE_MISMATCH");
  }
  const permit = validRecords(activePermitSchema, permitRows as unknown[])
    .filter((record) => record.stall_id === stallId)
    .sort((left, right) => Date.parse(right.issued_at) - Date.parse(left.issued_at))[0];
  if (!permit) throw new OfflineLocalOperationError("OFFLINE_BOOTSTRAP_REQUIRED");
  if (permit.device_id !== device.id) {
    throw new OfflineLocalOperationError("OFFLINE_SCOPE_MISMATCH");
  }
  if (Date.parse(permit.expires_at) <= now.getTime()) {
    throw new OfflineLocalOperationError("OFFLINE_PERMIT_EXPIRED");
  }
  const menu = parseRecord(
    menuSnapshotSchema,
    await requestResult(
      transaction.objectStore("menu_snapshots").get(
        `${stallId}:${permit.menu_snapshot_version}`,
      ),
    ),
    "OFFLINE_BOOTSTRAP_REQUIRED",
  );
  if (menu.stall_id !== stallId || menu.catalog.stall.id !== stallId) {
    throw new OfflineLocalOperationError("OFFLINE_SCOPE_MISMATCH");
  }
  if (Date.parse(menu.expires_at) <= now.getTime()) {
    throw new OfflineLocalOperationError("OFFLINE_MENU_EXPIRED");
  }
  return { device, permit, menu };
}

export async function createOfflineOrder(
  draft: CreateOfflineOrderDraft,
  now = new Date(),
) {
  const database = await openOfflineDatabase();
  const stores = [
    "device_profile",
    "offline_permit",
    "menu_snapshots",
    "cash_shift_snapshot",
    "offline_orders",
    "offline_order_events",
    "offline_payments",
    "offline_print_jobs",
    "sync_queue",
  ];
  try {
    const transaction = database.transaction(stores, "readwrite", { durability: "strict" });
    const completion = transactionComplete(transaction);
    const { device, permit, menu } = await readBootstrap(
      transaction,
      draft.organizationId,
      draft.stallId,
      now,
    );
    if (!permit.allowed_offline_actions.includes("CREATE_OFFLINE_ORDER")) {
      throw new OfflineLocalOperationError("OFFLINE_ACTION_NOT_ALLOWED");
    }

    const catalog = menu.catalog;
    if (
      draft.items.length < 1
      || draft.items.length > 100
      || orderItemsExceedLimits(draft.items, draft.note, catalog.limits)
    ) {
      throw new OfflineLocalOperationError("OFFLINE_ITEM_LIMIT_EXCEEDED");
    }
    const itemSnapshots = prepareOfflineOrderItemSnapshots(draft.items, catalog, now);
    const subtotal = itemSnapshots.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    if (subtotal > permit.risk_limits.maxSingleOrderAmount) {
      throw new OfflineLocalOperationError("OFFLINE_RISK_LIMIT_REACHED");
    }

    const orderRows = await requestResult(transaction.objectStore("offline_orders").getAll()) as StoredOrder[];
    const unsynchronizedOrders = orderRows.filter((row) => (
      row.stall_id === draft.stallId && UNSYNCHRONIZED.has(row.sync_status)
    ));
    if (
      unsynchronizedOrders.length >= permit.risk_limits.maxPendingOrders
      || unsynchronizedOrders.reduce((sum, row) => sum + Number(row.payload?.total ?? 0), 0) + subtotal
        > permit.risk_limits.maxTotalAmount
    ) {
      throw new OfflineLocalOperationError("OFFLINE_RISK_LIMIT_REACHED");
    }

    let method: OfflinePaymentMethod | null = null;
    let payment: OfflinePayment | null = null;
    const offlineOrderId = createWebUuid();
    if (draft.paymentTiming === "PAY_NOW") {
      if (!permit.allowed_offline_actions.includes("RECORD_CASH_PAYMENT")) {
        throw new OfflineLocalOperationError("OFFLINE_PAYMENT_NOT_ALLOWED");
      }
      const option = catalog.paymentOptions.find((candidate) => candidate.id === draft.paymentOptionId);
      if (!option) throw new OfflineLocalOperationError("OFFLINE_PAYMENT_NOT_ALLOWED");
      method = paymentMethodForKind(option.kind);
      if (method === "CASH") {
        const shift = parseRecord(
          cashShiftSnapshotSchema,
          await requestResult(transaction.objectStore("cash_shift_snapshot").get(draft.stallId)),
          "OFFLINE_CASH_SHIFT_REQUIRED",
        );
        if (shift.status !== "OPEN" || !shift.shift_id) {
          throw new OfflineLocalOperationError("OFFLINE_CASH_SHIFT_REQUIRED");
        }
        const received = draft.cashReceived ?? subtotal;
        payment = parseRecord(offlinePaymentSchema, {
          localPaymentId: createWebUuid(),
          offlineOrderId,
          paymentOptionId: option.id,
          method,
          status: "PAID_LOCAL",
          amount: subtotal,
          cashReceived: received,
          changeAmount: received - subtotal,
          methodLabel: option.name,
          cashShiftId: shift.shift_id,
          recordedAtDevice: now.toISOString(),
        }, "OFFLINE_PAYMENT_NOT_ALLOWED");
        transaction.objectStore("cash_shift_snapshot").put(withOfflineRecordMetadata({
          ...shift,
          offline_cash_sales: Number(shift.offline_cash_sales ?? 0) + subtotal,
          cash_sales: Number(shift.cash_sales ?? 0) + subtotal,
          expected_amount: Number(shift.expected_amount ?? 0) + subtotal,
        }, now));
      } else {
        const pendingManualTotal = unsynchronizedOrders.reduce((sum, row) => (
          row.payload?.paymentStatus === "PENDING_RECONCILIATION" ? sum + row.payload.total : sum
        ), 0);
        if (
          subtotal > permit.risk_limits.maxManualPaymentAmount
          || pendingManualTotal + subtotal > permit.risk_limits.maxTotalManualPaymentAmount
        ) {
          throw new OfflineLocalOperationError("OFFLINE_PAYMENT_NOT_ALLOWED");
        }
        if (
          permit.risk_limits.requireCustomerContactAboveAmount > 0
          && subtotal >= permit.risk_limits.requireCustomerContactAboveAmount
          && !draft.customerContact.trim()
        ) {
          throw new OfflineLocalOperationError("OFFLINE_CUSTOMER_CONTACT_REQUIRED");
        }
        if (
          permit.risk_limits.managerApprovalThreshold > 0
          && subtotal >= permit.risk_limits.managerApprovalThreshold
          && !permit.roles.some((role) => MANAGER_ROLES.has(role))
        ) {
          throw new OfflineLocalOperationError("OFFLINE_MANAGER_REQUIRED");
        }
        payment = parseRecord(offlinePaymentSchema, {
          localPaymentId: createWebUuid(),
          offlineOrderId,
          paymentOptionId: option.id,
          method,
          status: "PENDING_RECONCILIATION",
          amount: subtotal,
          cashReceived: null,
          changeAmount: null,
          methodLabel: option.name,
          cashShiftId: null,
          recordedAtDevice: now.toISOString(),
        }, "OFFLINE_PAYMENT_NOT_ALLOWED");
      }
    }

    const localSequence = orderRows
      .filter((row) => (
        row.stall_id === draft.stallId
        && row.payload.localDisplayNumber.includes(`-${localBusinessDate(now, catalog.stall.timezone)}-`)
      ))
      .reduce((maximum, row) => Math.max(maximum, row.payload.localSequence), 0) + 1;
    const localDisplayNumber = `OFF-${deviceCode(device.id)}-${localBusinessDate(now, catalog.stall.timezone)}-${localSequence}`;
    const order = parseRecord(offlineOrderSchema, {
      offlineOrderId,
      deviceId: device.id,
      organizationId: draft.organizationId,
      stallId: draft.stallId,
      localSequence,
      localDisplayNumber,
      menuSnapshotVersion: menu.version,
      itemsSnapshot: itemSnapshots,
      subtotal,
      discountAmount: 0,
      total: subtotal,
      currency: menu.currency,
      paymentMethod: method,
      paymentStatus: payment?.status ?? "UNPAID",
      orderStatus: "LOCAL_CONFIRMED",
      customerLabel: draft.customerLabel.trim(),
      customerContact: draft.customerContact.trim(),
      note: draft.note.trim(),
      createdAtDevice: now.toISOString(),
      updatedAtDevice: now.toISOString(),
      idempotencyKey: draft.idempotencyKey,
      syncStatus: "PENDING",
      retryCount: 0,
      lastRetryAt: null,
      promotionEpoch: permit.promotion_epoch,
      protocolVersion: permit.app_protocol_version,
    }, "OFFLINE_ITEM_LIMIT_EXCEEDED");
    const event = parseRecord(offlineOrderEventSchema, {
      eventId: createWebUuid(),
      offlineOrderId,
      previousState: null,
      nextState: "LOCAL_CONFIRMED",
      reason: null,
      occurredAtDevice: now.toISOString(),
    }, "OFFLINE_ITEM_LIMIT_EXCEEDED");
    const printJob = draft.queuePrint && catalog.modules.print
      && permit.allowed_offline_actions.includes("QUEUE_PRINT_JOB")
      ? parseRecord(offlinePrintJobSchema, {
          printJobId: createWebUuid(),
          offlineOrderId,
          printerId: null,
          templateVersion: "offline-v1",
          status: "PENDING",
          attemptCount: 0,
          printedAt: null,
          deduplicationKey: `offline-order:${offlineOrderId}:receipt:v1`,
        }, "OFFLINE_ACTION_NOT_ALLOWED")
      : null;
    const queueId = createWebUuid();
    const queue = withOfflineRecordMetadata({
      queue_id: queueId,
      idempotency_key: order.idempotencyKey,
      entity_type: "ORDER",
      entity_id: offlineOrderId,
      stall_id: draft.stallId,
      status: "PENDING",
      retry_count: 0,
      next_attempt_at: now.toISOString(),
    }, now);

    transaction.objectStore("offline_orders").add(withOfflineRecordMetadata({
      local_order_id: offlineOrderId,
      stall_id: draft.stallId,
      sync_status: "PENDING",
      payload: order,
    }, now));
    transaction.objectStore("offline_order_events").add(withOfflineRecordMetadata({
      event_id: event.eventId,
      local_order_id: offlineOrderId,
      payload: event,
    }, now));
    if (payment) {
      transaction.objectStore("offline_payments").add(withOfflineRecordMetadata({
        local_payment_id: payment.localPaymentId,
        local_order_id: offlineOrderId,
        payload: payment,
      }, now));
    }
    if (printJob) {
      transaction.objectStore("offline_print_jobs").add(withOfflineRecordMetadata({
        print_job_id: printJob.printJobId,
        local_order_id: offlineOrderId,
        deduplication_key: printJob.deduplicationKey,
        payload: printJob,
      }, now));
    }
    transaction.objectStore("sync_queue").add(queue);
    await completion;
    notifyOfflineDataChanged();
    return { order, event, payment, printJob, queueId };
  } finally {
    database.close();
  }
}

export async function listUnsynchronizedOfflineOrders(stallId: string) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction("offline_orders", "readonly");
    const completion = transactionComplete(transaction);
    const rows = await requestResult(
      transaction.objectStore("offline_orders").index("stall_id").getAll(stallId),
    ) as StoredOrder[];
    await completion;
    return rows
      .filter((row) => UNSYNCHRONIZED.has(row.sync_status))
      .map((row) => offlineOrderSchema.safeParse(row.payload))
      .flatMap((parsed) => parsed.success ? [parsed.data] : [])
      .sort((left, right) => left.createdAtDevice.localeCompare(right.createdAtDevice));
  } finally {
    database.close();
  }
}

export async function queueOfflinePrintJob(
  offlineOrderId: string,
  now = new Date(),
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(
      [
        "device_profile",
        "offline_permit",
        "menu_snapshots",
        "offline_orders",
        "offline_print_jobs",
      ],
      "readwrite",
      { durability: "strict" },
    );
    const completion = transactionComplete(transaction);
    const orderRow = await requestResult(
      transaction.objectStore("offline_orders").get(offlineOrderId),
    ) as StoredOrder | undefined;
    if (!orderRow || !UNSYNCHRONIZED.has(orderRow.sync_status)) {
      throw new OfflineLocalOperationError("OFFLINE_RECORD_NOT_FOUND");
    }
    const order = parseRecord(
      offlineOrderSchema,
      orderRow.payload,
      "OFFLINE_RECORD_NOT_FOUND",
    );
    const existingRows = await requestResult(
      transaction.objectStore("offline_print_jobs")
        .index("local_order_id")
        .getAll(offlineOrderId),
    ) as StoredPrintJob[];
    const existing = existingRows
      .map((row) => offlinePrintJobSchema.safeParse(row.payload))
      .find((parsed) => parsed.success);
    if (existing?.success) {
      await completion;
      return existing.data;
    }
    const { permit, menu } = await readBootstrap(
      transaction,
      order.organizationId,
      order.stallId,
      now,
    );
    if (
      !menu.catalog.modules.print
      || !permit.allowed_offline_actions.includes("QUEUE_PRINT_JOB")
    ) {
      throw new OfflineLocalOperationError("OFFLINE_ACTION_NOT_ALLOWED");
    }
    const printJob = offlinePrintJobSchema.parse({
      printJobId: createWebUuid(),
      offlineOrderId,
      printerId: null,
      templateVersion: "offline-v1",
      status: "PENDING",
      attemptCount: 0,
      printedAt: null,
      deduplicationKey: `offline-order:${offlineOrderId}:receipt:v1`,
    });
    transaction.objectStore("offline_print_jobs").add(withOfflineRecordMetadata({
      print_job_id: printJob.printJobId,
      local_order_id: offlineOrderId,
      deduplication_key: printJob.deduplicationKey,
      payload: printJob,
    }, now));
    await completion;
    notifyOfflineDataChanged();
    return printJob;
  } finally {
    database.close();
  }
}

export async function transitionOfflineOrder(
  offlineOrderId: string,
  nextState: OfflineOrderState,
  reason: string | null = null,
  now = new Date(),
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(
      ["offline_orders", "offline_order_events"],
      "readwrite",
      { durability: "strict" },
    );
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore("offline_orders");
    const current = await requestResult(store.get(offlineOrderId)) as StoredOrder | undefined;
    if (!current) throw new OfflineLocalOperationError("OFFLINE_RECORD_NOT_FOUND");
    const order = parseRecord(
      offlineOrderSchema,
      current.payload,
      "OFFLINE_RECORD_NOT_FOUND",
    );
    if (
      !UNSYNCHRONIZED.has(current.sync_status)
      || !canTransitionOfflineOrder(order.orderStatus, nextState)
      || (nextState === "LOCAL_COMPLETED" && order.paymentStatus === "UNPAID")
    ) {
      throw new OfflineLocalOperationError("OFFLINE_INVALID_STATE_TRANSITION");
    }
    const updated = offlineOrderSchema.parse({
      ...order,
      orderStatus: nextState,
      updatedAtDevice: now.toISOString(),
      syncStatus: "PENDING",
    });
    const event = offlineOrderEventSchema.parse({
      eventId: createWebUuid(),
      offlineOrderId,
      previousState: order.orderStatus,
      nextState,
      reason: reason?.trim() || null,
      occurredAtDevice: now.toISOString(),
    });
    store.put(withOfflineRecordMetadata({
      ...current,
      sync_status: "PENDING",
      payload: updated,
    }, now));
    transaction.objectStore("offline_order_events").add(withOfflineRecordMetadata({
      event_id: event.eventId,
      local_order_id: offlineOrderId,
      payload: event,
    }, now));
    await completion;
    notifyOfflineDataChanged();
    return updated;
  } finally {
    database.close();
  }
}

export async function createOfflineCashEvent(
  input: {
    organizationId: string;
    stallId: string;
    eventType: "CASH_IN" | "CASH_OUT" | "PROVISIONAL_CLOSE";
    amount: number;
    countedAmount?: number | null;
    reason: string;
  },
  now = new Date(),
) {
  const database = await openOfflineDatabase();
  const stores = [
    "device_profile",
    "offline_permit",
    "menu_snapshots",
    "cash_shift_snapshot",
    "sync_queue",
  ];
  try {
    const transaction = database.transaction(stores, "readwrite", { durability: "strict" });
    const completion = transactionComplete(transaction);
    const { device, permit } = await readBootstrap(
      transaction,
      input.organizationId,
      input.stallId,
      now,
    );
    if (!permit.allowed_offline_actions.includes("RECORD_CASH_PAYMENT")) {
      throw new OfflineLocalOperationError("OFFLINE_ACTION_NOT_ALLOWED");
    }
    const shift = parseRecord(
      cashShiftSnapshotSchema,
      await requestResult(transaction.objectStore("cash_shift_snapshot").get(input.stallId)),
      "OFFLINE_CASH_SHIFT_REQUIRED",
    );
    if (shift.status !== "OPEN" || !shift.shift_id) {
      throw new OfflineLocalOperationError("OFFLINE_CASH_SHIFT_REQUIRED");
    }
    const cashEventId = createWebUuid();
    const queueId = createWebUuid();
    const event = offlineCashEventSchema.parse({
      cashEventId,
      deviceId: device.id,
      organizationId: input.organizationId,
      stallId: input.stallId,
      cashShiftId: shift.shift_id,
      eventType: input.eventType,
      amount: input.amount,
      countedAmount: input.eventType === "PROVISIONAL_CLOSE"
        ? input.countedAmount ?? null
        : null,
      reason: input.reason,
      occurredAtDevice: now.toISOString(),
      idempotencyKey: createWebUuid(),
      promotionEpoch: permit.promotion_epoch,
      protocolVersion: permit.app_protocol_version,
    });
    const storedEvent: StoredCashEvent = {
      ...event,
      sync_status: "PENDING",
      queue_id: queueId,
    };
    const expectedDelta = input.eventType === "CASH_IN"
      ? input.amount
      : input.eventType === "CASH_OUT" ? -input.amount : 0;
    transaction.objectStore("cash_shift_snapshot").put(withOfflineRecordMetadata({
      ...shift,
      status: input.eventType === "PROVISIONAL_CLOSE" ? "PROVISIONAL_CLOSE" : shift.status,
      cash_in: Number(shift.cash_in ?? 0) + (input.eventType === "CASH_IN" ? input.amount : 0),
      cash_out: Number(shift.cash_out ?? 0) + (input.eventType === "CASH_OUT" ? input.amount : 0),
      expected_amount: Number(shift.expected_amount ?? 0) + expectedDelta,
      pending_events: [...shift.pending_events, storedEvent],
    }, now));
    transaction.objectStore("sync_queue").add(withOfflineRecordMetadata({
      queue_id: queueId,
      idempotency_key: event.idempotencyKey,
      entity_type: "CASH_EVENT",
      entity_id: cashEventId,
      stall_id: input.stallId,
      status: "PENDING",
      retry_count: 0,
      next_attempt_at: now.toISOString(),
    }, now));
    await completion;
    notifyOfflineDataChanged();
    return event;
  } finally {
    database.close();
  }
}

export async function getOfflineCashShiftSnapshot(stallId: string) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction("cash_shift_snapshot", "readonly");
    const completion = transactionComplete(transaction);
    const value = await requestResult(
      transaction.objectStore("cash_shift_snapshot").get(stallId),
    );
    await completion;
    const parsed = cashShiftSnapshotSchema.safeParse(value);
    if (!parsed.success) return null;
    return {
      stallId: parsed.data.stall_id,
      shiftId: parsed.data.shift_id,
      status: parsed.data.status,
      openingAmount: parsed.data.opening_amount ?? 0,
      cashSales: parsed.data.cash_sales ?? 0,
      cashIn: parsed.data.cash_in ?? 0,
      cashOut: parsed.data.cash_out ?? 0,
      cashRefund: parsed.data.cash_refund ?? 0,
      correction: parsed.data.correction ?? 0,
      expectedAmount: parsed.data.expected_amount ?? 0,
      pendingEvents: parsed.data.pending_events.flatMap((event) => {
        const result = offlineCashEventSchema.safeParse(event);
        return result.success ? [result.data] : [];
      }),
    };
  } finally {
    database.close();
  }
}

export async function getOfflineSyncContext(stallId: string) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(["device_profile", "offline_permit"], "readonly");
    const completion = transactionComplete(transaction);
    const [devices, permits] = await Promise.all([
      requestResult(transaction.objectStore("device_profile").getAll()),
      requestResult(transaction.objectStore("offline_permit").getAll()),
    ]);
    await completion;
    const device = validRecords(deviceProfileSchema, devices as unknown[])
      .find((record) => record.stall_id === stallId);
    const permit = validRecords(activePermitSchema, permits as unknown[])
      .filter((record) => record.stall_id === stallId)
      .sort((left, right) => Date.parse(right.issued_at) - Date.parse(left.issued_at))[0];
    return device && permit ? {
      installationId: device.installation_id,
      permitToken: permit.token,
      deviceId: device.id,
      expiresAt: permit.expires_at,
    } : null;
  } finally {
    database.close();
  }
}

export async function loadOfflineSyncBatch(
  stallId: string,
  batchSize = 25,
  now = new Date(),
) {
  const safeBatchSize = Math.max(10, Math.min(50, Math.trunc(batchSize)));
  const database = await openOfflineDatabase();
  const stores = [
    "sync_queue",
    "offline_orders",
    "offline_order_events",
    "offline_payments",
    "offline_print_jobs",
    "cash_shift_snapshot",
  ];
  try {
    const transaction = database.transaction(stores, "readonly");
    const completion = transactionComplete(transaction);
    const [
      queueRows,
      orderRows,
      eventRows,
      paymentRows,
      printRows,
      cashRows,
    ] = await Promise.all([
      requestResult(transaction.objectStore("sync_queue").getAll()) as Promise<StoredQueueRecord[]>,
      requestResult(transaction.objectStore("offline_orders").getAll()) as Promise<StoredOrder[]>,
      requestResult(transaction.objectStore("offline_order_events").getAll()) as Promise<StoredEvent[]>,
      requestResult(transaction.objectStore("offline_payments").getAll()) as Promise<StoredPayment[]>,
      requestResult(transaction.objectStore("offline_print_jobs").getAll()) as Promise<StoredPrintJob[]>,
      requestResult(transaction.objectStore("cash_shift_snapshot").getAll()) as Promise<unknown[]>,
    ]);
    await completion;
    const selected = queueRows
      .filter((row) => (
        row.stall_id === stallId
        && ["PENDING", "FAILED", "PROCESSING"].includes(row.status)
        && Date.parse(row.next_attempt_at) <= now.getTime()
      ))
      .sort((left, right) => Date.parse(String(left.created_at)) - Date.parse(String(right.created_at)))
      .slice(0, safeBatchSize);
    const ordersById = new Map(orderRows.map((row) => [row.local_order_id, row]));
    const eventsByOrderId = Map.groupBy(eventRows, (row) => row.local_order_id);
    const paymentsByOrderId = Map.groupBy(paymentRows, (row) => row.local_order_id);
    const printsByOrderId = Map.groupBy(printRows, (row) => row.local_order_id);
    const cashSnapshot = cashRows
      .map((row) => cashShiftSnapshotSchema.safeParse(row))
      .find((parsed) => parsed.success && parsed.data.stall_id === stallId);
    const records: OfflineSyncRecord[] = [];
    for (const queue of selected) {
      if (queue.entity_type === "ORDER") {
        const storedOrder = ordersById.get(queue.entity_id);
        if (!storedOrder) continue;
        records.push({
          recordType: "ORDER",
          queueId: queue.queue_id,
          order: offlineOrderSchema.parse(storedOrder.payload),
          events: (eventsByOrderId.get(queue.entity_id) ?? [])
            .map((row) => offlineOrderEventSchema.parse(row.payload))
            .sort((left, right) => Date.parse(left.occurredAtDevice) - Date.parse(right.occurredAtDevice)),
          payment: paymentsByOrderId.get(queue.entity_id)?.[0]
            ? offlinePaymentSchema.parse(paymentsByOrderId.get(queue.entity_id)?.[0].payload)
            : null,
          printJobs: (printsByOrderId.get(queue.entity_id) ?? []).map(
            (row) => offlinePrintJobSchema.parse(row.payload),
          ),
        });
        continue;
      }
      if (!cashSnapshot?.success) continue;
      const event = (cashSnapshot.data.pending_events as StoredCashEvent[])
        .find((candidate) => candidate.cashEventId === queue.entity_id);
      if (event) {
        records.push({
          recordType: "CASH_EVENT",
          queueId: queue.queue_id,
          event: offlineCashEventSchema.parse(event),
        });
      }
    }
    return records;
  } finally {
    database.close();
  }
}

export async function markOfflineSyncAttempt(
  queueIds: string[],
  result: "PROCESSING" | "FAILED",
  retryAt: Date,
  now = new Date(),
) {
  if (queueIds.length === 0) return;
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(
      ["sync_queue", "offline_orders"],
      "readwrite",
      { durability: "strict" },
    );
    const completion = transactionComplete(transaction);
    for (const queueId of queueIds) {
      const queueStore = transaction.objectStore("sync_queue");
      const queue = await requestResult(queueStore.get(queueId)) as StoredQueueRecord | undefined;
      if (!queue) continue;
      const retryCount = queue.retry_count + (result === "FAILED" ? 1 : 0);
      queueStore.put(withOfflineRecordMetadata({
        ...queue,
        status: result,
        retry_count: retryCount,
        next_attempt_at: retryAt.toISOString(),
        last_retry_at: now.toISOString(),
      }, now));
      if (queue.entity_type === "ORDER") {
        const orderStore = transaction.objectStore("offline_orders");
        const row = await requestResult(orderStore.get(queue.entity_id)) as StoredOrder | undefined;
        if (row) {
          const order = offlineOrderSchema.parse(row.payload);
          orderStore.put(withOfflineRecordMetadata({
            ...row,
            sync_status: result,
            payload: {
              ...order,
              syncStatus: result,
              retryCount,
              lastRetryAt: now.toISOString(),
            },
          }, now));
        }
      }
    }
    await completion;
  } finally {
    database.close();
  }
}

export async function applyOfflineSyncResponse(
  response: OfflineSyncResponse,
  now = new Date(),
) {
  const database = await openOfflineDatabase();
  const stores = [
    "sync_queue",
    "offline_orders",
    "cash_shift_snapshot",
    "sync_receipts",
    "sync_conflicts",
  ];
  try {
    const transaction = database.transaction(stores, "readwrite", { durability: "strict" });
    const completion = transactionComplete(transaction);
    for (const receipt of response.receipts) {
      const queueStore = transaction.objectStore("sync_queue");
      const queue = await requestResult(queueStore.get(receipt.queueId)) as StoredQueueRecord | undefined;
      if (!queue) continue;
      const accepted = receipt.outcome !== "REJECTED";
      const withConflict = receipt.outcome === "ACCEPTED_WITH_CONFLICT";
      const localStatus = accepted
        ? withConflict ? "SYNCED_WITH_CONFLICT" : "SYNCED"
        : "REJECTED";
      queueStore.put(withOfflineRecordMetadata({
        ...queue,
        status: localStatus,
        next_attempt_at: now.toISOString(),
        synced_at: accepted ? receipt.serverReceivedAt : null,
        last_error_code: receipt.errorCode ?? null,
      }, now));
      transaction.objectStore("sync_receipts").put(withOfflineRecordMetadata({
        idempotency_key: queue.idempotency_key,
        ...receipt,
        promotion_epoch: response.promotionEpoch,
        retained_until: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
      }, now));
      if (queue.entity_type === "ORDER") {
        const orderStore = transaction.objectStore("offline_orders");
        const row = await requestResult(orderStore.get(queue.entity_id)) as StoredOrder | undefined;
        if (row) {
          const order = offlineOrderSchema.parse(row.payload);
          orderStore.put(withOfflineRecordMetadata({
            ...row,
            sync_status: localStatus,
            canonical_order_id: receipt.canonicalOrderId,
            canonical_order_number: receipt.canonicalOrderNumber,
            synced_at: accepted ? receipt.serverReceivedAt : null,
            purge_after: accepted
              ? new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString()
              : null,
            payload: { ...order, syncStatus: localStatus },
          }, now));
        }
      } else {
        const cashStore = transaction.objectStore("cash_shift_snapshot");
        const cash = cashShiftSnapshotSchema.parse(await requestResult(cashStore.get(queue.stall_id)));
        cashStore.put(withOfflineRecordMetadata({
          ...cash,
          pending_events: (cash.pending_events as StoredCashEvent[]).map((event) => (
            event.cashEventId === queue.entity_id
              ? { ...event, sync_status: localStatus }
              : event
          )),
        }, now));
      }
      for (const conflict of receipt.conflicts) {
        transaction.objectStore("sync_conflicts").put(withOfflineRecordMetadata({
          conflict_id: conflict.conflictId,
          queue_id: receipt.queueId,
          stall_id: queue.stall_id,
          local_entity_id: receipt.localEntityId,
          conflict_type: conflict.type,
          resolution_status: conflict.resolutionStatus,
          canonical_order_id: receipt.canonicalOrderId,
          detected_at: receipt.serverReceivedAt,
        }, now));
      }
    }
    await completion;
    notifyOfflineDataChanged();
  } finally {
    database.close();
  }
}

export async function getOfflineQueueSummary(stallId: string) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(
      ["sync_queue", "sync_conflicts", "offline_permit", "availability_config"],
      "readonly",
    );
    const completion = transactionComplete(transaction);
    const [queues, conflicts, permits, availability] = await Promise.all([
      requestResult(transaction.objectStore("sync_queue").getAll()),
      requestResult(transaction.objectStore("sync_conflicts").getAll()),
      requestResult(transaction.objectStore("offline_permit").getAll()),
      requestResult(transaction.objectStore("availability_config").get(stallId)),
    ]);
    await completion;
    const pending = (queues as StoredQueueRecord[]).filter(
      (row) => row.stall_id === stallId && UNSYNCHRONIZED.has(row.status),
    );
    const permit = validRecords(activePermitSchema, permits as unknown[])
      .filter((record) => record.stall_id === stallId)
      .sort((left, right) => Date.parse(right.issued_at) - Date.parse(left.issued_at))[0];
    return {
      pendingCount: pending.length,
      oldestPendingAt: pending.length > 0
        ? pending.reduce((oldest, row) => (
            Date.parse(String(row.created_at)) < Date.parse(oldest)
              ? String(row.created_at)
              : oldest
          ), String(pending[0].created_at))
        : null,
      conflictCount: (conflicts as Array<{ resolution_status?: string; stall_id?: string }>)
        .filter((conflict) => (
          conflict.resolution_status === "OPEN" && conflict.stall_id === stallId
        )).length,
      permitExpiresAt: permit?.expires_at ?? null,
      storageClass: typeof (availability as { storage_class?: unknown } | undefined)?.storage_class === "string"
        ? (availability as { storage_class: string }).storage_class
        : null,
    };
  } finally {
    database.close();
  }
}

export async function purgeExpiredOfflinePayloads(now = new Date()) {
  const database = await openOfflineDatabase();
  const stores = [
    "offline_orders",
    "offline_order_events",
    "offline_payments",
    "offline_print_jobs",
    "sync_receipts",
  ];
  try {
    const transaction = database.transaction(stores, "readwrite", { durability: "strict" });
    const completion = transactionComplete(transaction);
    const orderStore = transaction.objectStore("offline_orders");
    const orders = await requestResult(orderStore.getAll()) as Array<StoredOrder & { purge_after?: string }>;
    for (const row of orders) {
      if (!row.purge_after || Date.parse(row.purge_after) > now.getTime()) continue;
      orderStore.delete(row.local_order_id);
      for (const [storeName, indexName] of [
        ["offline_order_events", "local_order_id"],
        ["offline_payments", "local_order_id"],
        ["offline_print_jobs", "local_order_id"],
      ] as const) {
        const store = transaction.objectStore(storeName);
        const keys = await requestResult(store.index(indexName).getAllKeys(row.local_order_id));
        keys.forEach((key) => store.delete(key));
      }
    }
    const receiptStore = transaction.objectStore("sync_receipts");
    const receipts = await requestResult(receiptStore.getAll()) as Array<{
      idempotency_key: string;
      retained_until?: string;
    }>;
    receipts.filter((receipt) => (
      receipt.retained_until && Date.parse(receipt.retained_until) <= now.getTime()
    )).forEach((receipt) => receiptStore.delete(receipt.idempotency_key));
    await completion;
  } finally {
    database.close();
  }
}
