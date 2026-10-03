import { z } from "zod";

export const mobileUserRoleSchema = z.enum([
  "PLATFORM_ADMIN",
  "MERCHANT_OWNER",
  "MERCHANT_MANAGER",
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "FINANCE_VIEWER",
  "STALL_MANAGER",
  "STAFF",
  "KITCHEN",
]);

export const mobilePermissionSchema = z.enum([
  "VIEW_ORDERS",
  "CREATE_ORDERS",
  "UPDATE_ORDERS",
  "CHECKOUT_ORDERS",
  "MANAGE_PRINT_QUEUE",
  "VIEW_CASH_SHIFT",
  "MANAGE_CASH_SHIFT",
  "REVIEW_CASH_SHIFT",
  "APPROVE_DISCOUNT",
  "VIEW_DINING_FLOOR",
  "MANAGE_PRODUCTS",
  "MANAGE_ORDERING",
  "VIEW_REPORTS",
  "MANAGE_STAFF",
  "MANAGE_STALL",
  "MANAGE_ORGANIZATION",
  "MANAGE_SUBSCRIPTION",
  "VIEW_BILLING",
  "MANAGE_SHARED_PRODUCTS",
  "VIEW_AUDIT_LOGS",
  "MANAGE_OPERATIONAL_ALERTS",
  "MANAGE_REPORT_SCHEDULES",
  "VIEW_KDS",
  "UPDATE_PRODUCTION_TASKS",
  "MANAGE_KDS",
  "MANAGE_CDS",
  "MANAGE_CAPACITY",
  "OPERATE_CAPACITY",
  "MANAGE_STALL_LOCATIONS",
  "MANAGE_STALL_SCHEDULES",
  "MANAGE_MARKET_EVENTS",
  "MANAGE_LINE_INTEGRATION",
  "MANAGE_DELIVERY_INTEGRATIONS",
  "MANAGE_PAYMENT_INTEGRATIONS",
  "REFUND_PROVIDER_PAYMENTS",
  "PLATFORM_ADMIN",
]);

export const mobileErrorSchema = z.object({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
  requestId: z.string().uuid(),
}).strict();

export const mobileLoginRequestSchema = z.object({
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  deviceId: z.string().uuid(),
}).strict();

export const mobileSessionSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43,512}$/),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const mobileLoginResponseSchema = z.object({
  version: z.literal("v1"),
  session: mobileSessionSchema,
}).strict();

export const mobileSessionRefreshResponseSchema = z.object({
  version: z.literal("v1"),
  session: mobileSessionSchema,
}).strict();

const mobileStallSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  code: z.string(),
  businessStatus: z.enum(["OPEN", "PAUSED", "CLOSED", "SOLD_OUT"]),
  orderingEnabled: z.boolean(),
  isActive: z.boolean(),
  kdsEnabled: z.boolean(),
  roles: z.array(mobileUserRoleSchema),
  permissions: z.array(mobilePermissionSchema),
}).strict();

const mobileWorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  businessName: z.string(),
  slug: z.string(),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "SUSPENDED", "CANCELLED"]),
  defaultCurrency: z.string(),
  roles: z.array(mobileUserRoleSchema),
  permissions: z.array(mobilePermissionSchema),
  canUseAllStalls: z.boolean(),
  stalls: z.array(mobileStallSchema),
}).strict();

export const mobileBootstrapResponseSchema = z.object({
  version: z.literal("v1"),
  sessionExpiresAt: z.string().datetime({ offset: true }),
  principal: z.object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    displayName: z.string(),
    platformRole: mobileUserRoleSchema.nullable(),
  }).strict(),
  workspaces: z.array(mobileWorkspaceSchema),
  featureFlags: z.object({
    mobileApp: z.boolean(),
    platformAdmin: z.boolean(),
    push: z.boolean(),
    offlinePos: z.boolean(),
    directPrint: z.boolean(),
    localFixtureLab: z.boolean(),
  }).strict(),
}).strict();

export const mobileOrderStatusSchema = z.enum([
  "WAITING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "PACKING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);

export const mobilePaymentStatusSchema = z.enum([
  "UNPAID",
  "PAID",
  "REFUNDED",
  "PENDING_RECONCILIATION",
]);

export const mobileFulfillmentTypeSchema = z.enum(["TAKEOUT", "DINE_IN", "DELIVERY"]);

export const mobileOrdersQuerySchema = z.object({
  statuses: z.array(mobileOrderStatusSchema).max(8).refine(
    (statuses) => new Set(statuses).size === statuses.length,
    { message: "訂單狀態不可重複。" },
  ),
  query: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{16,512}$/).optional(),
  limit: z.number().int().min(1).max(50),
}).strict();

const mobileOrderSummarySchema = z.object({
  id: z.string().uuid(),
  orderNo: z.string().min(1).max(80),
  status: mobileOrderStatusSchema,
  paymentStatus: mobilePaymentStatusSchema,
  fulfillmentType: mobileFulfillmentTypeSchema,
  customerName: z.string().max(120),
  tableLabel: z.string().max(120).nullable(),
  total: z.number().int().safe().nonnegative(),
  itemCount: z.number().int().safe().nonnegative(),
  isTest: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export const mobileOrderListResponseSchema = z.object({
  version: z.literal("v1"),
  generatedAt: z.string().datetime({ offset: true }),
  stallId: z.string().uuid(),
  orders: z.array(mobileOrderSummarySchema).max(50),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{16,512}$/).nullable(),
}).strict();

export const mobileOrderDetailResponseSchema = z.object({
  version: z.literal("v1"),
  generatedAt: z.string().datetime({ offset: true }),
  stallId: z.string().uuid(),
  order: mobileOrderSummarySchema.extend({
    source: z.string().min(1).max(80),
    note: z.string().max(1_000).nullable(),
    items: z.array(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200),
      unitPrice: z.number().int().safe().nonnegative(),
      quantity: z.number().int().safe().positive(),
      note: z.string().max(1_000).nullable(),
      status: z.enum(["PENDING", "PREPARING", "READY", "SERVED"]),
      noteOptions: z.array(z.object({
        groupName: z.string().max(120),
        optionName: z.string().max(120),
        priceDelta: z.number().int().safe(),
      }).strict()),
    }).strict()).max(200),
  }).strict(),
}).strict();

export const mobileDashboardResponseSchema = z.object({
  version: z.literal("v1"),
  generatedAt: z.string().datetime({ offset: true }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stall: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    defaultCurrency: z.string().min(3).max(3),
    businessStatus: z.enum(["OPEN", "PAUSED", "CLOSED", "SOLD_OUT"]),
    orderingEnabled: z.boolean(),
  }).strict(),
  summary: z.object({
    totalSales: z.number().int().safe().nonnegative(),
    orderCount: z.number().int().safe().nonnegative(),
    completedOrderCount: z.number().int().safe().nonnegative(),
    cancelledOrderCount: z.number().int().safe().nonnegative(),
    pendingOrderCount: z.number().int().safe().nonnegative(),
    averageOrderValue: z.number().int().safe().nonnegative(),
  }).strict(),
  alerts: z.array(z.object({
    id: z.string().uuid(),
    severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
    message: z.string().max(1_000),
    status: z.enum(["ACTIVE", "ACKNOWLEDGED"]),
    detectedAt: z.string().datetime({ offset: true }),
  }).strict()).max(20),
  openCashShift: z.object({
    id: z.string().uuid(),
    openedAt: z.string().datetime({ offset: true }),
  }).strict().nullable(),
  pendingPrintJobCount: z.number().int().safe().nonnegative().nullable(),
  kdsQueue: z.object({
    pending: z.number().int().safe().nonnegative(),
    preparing: z.number().int().safe().nonnegative(),
  }).strict().nullable(),
  availability: z.object({
    mode: z.enum(["NORMAL_PRIMARY", "NORMAL_DR", "DEGRADED_SAFE"]),
    staffOnline: z.enum(["AVAILABLE", "DEGRADED", "UNAVAILABLE", "MAINTENANCE", "UNKNOWN"]),
    updatedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

export const mobileLocalLabPersonaSchema = z.enum(["MERCHANT", "PLATFORM_ADMIN"]);

export const mobileLocalLabSectionIdSchema = z.enum([
  "MERCHANT_ORDERS_POS",
  "MERCHANT_KDS",
  "MERCHANT_CASH_PRINT",
  "MERCHANT_CATALOG_ORDERING",
  "MERCHANT_LOCATIONS_SCHEDULE_EVENTS",
  "MERCHANT_TEAM",
  "MERCHANT_REPORTS_BILLING",
  "MERCHANT_INTEGRATIONS",
  "MERCHANT_ACCOUNT",
  "PLATFORM_APPLICATIONS",
  "PLATFORM_COMMERCIAL",
  "PLATFORM_BILLING_USAGE",
  "PLATFORM_INTEGRATIONS",
  "PLATFORM_AUDIT_SUPPORT",
]);

export const mobileLocalLabActionTypeSchema = z.enum([
  "ORDER_ADVANCE",
  "POS_ADD_ITEM",
  "POS_CHECKOUT",
  "KDS_ADVANCE",
  "CASH_SHIFT_TOGGLE",
  "PRINT_RETRY",
  "PRODUCT_TOGGLE",
  "ORDERING_TOGGLE",
  "CAPACITY_INCREASE",
  "LOCATION_TOGGLE",
  "SCHEDULE_TOGGLE",
  "EVENT_TOGGLE",
  "STAFF_TOGGLE",
  "INVITATION_SEND",
  "REPORT_SCHEDULE_TOGGLE",
  "INTEGRATION_SYNC",
  "SESSION_REVOKE_OTHERS",
  "ACCOUNT_DELETE_REQUEST",
  "ADMIN_APPLICATION_APPROVE",
  "ADMIN_PLAN_TOGGLE",
  "ADMIN_ENTITLEMENT_TOGGLE",
  "ADMIN_SUBSCRIPTION_PAUSE",
  "ADMIN_INVOICE_REVIEW",
  "ADMIN_DELIVERY_RETRY",
  "ADMIN_SUPPORT_LOOKUP",
]);

const mobileLocalLabActionSchema = z.object({
  type: mobileLocalLabActionTypeSchema,
  label: z.string().trim().min(1).max(80),
  confirm: z.boolean(),
}).strict();

const mobileLocalLabItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().min(1).max(500),
  status: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(120).nullable(),
  tone: z.enum(["NEUTRAL", "INFO", "SUCCESS", "WARNING", "DANGER"]),
  action: mobileLocalLabActionSchema.nullable(),
}).strict();

export const mobileLocalLabResponseSchema = z.object({
  version: z.literal("v1"),
  mode: z.literal("LOCAL_FIXTURE"),
  persona: mobileLocalLabPersonaSchema,
  generatedAt: z.string().datetime({ offset: true }),
  notice: z.string().trim().min(1).max(500),
  sections: z.array(z.object({
    id: mobileLocalLabSectionIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    items: z.array(mobileLocalLabItemSchema).min(1).max(20),
  }).strict()).min(1).max(20),
}).strict();

export const mobileLocalLabActionRequestSchema = z.object({
  action: mobileLocalLabActionTypeSchema,
  targetId: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().uuid(),
}).strict();

export const mobileLocalLabActionResponseSchema = z.object({
  version: z.literal("v1"),
  requestId: z.string().uuid(),
  applied: z.boolean(),
  message: z.string().trim().min(1).max(500),
  snapshot: mobileLocalLabResponseSchema,
}).strict();

export type MobileLoginRequest = z.infer<typeof mobileLoginRequestSchema>;
export type MobileLoginResponse = z.infer<typeof mobileLoginResponseSchema>;
export type MobileSession = z.infer<typeof mobileSessionSchema>;
export type MobileBootstrapResponse = z.infer<typeof mobileBootstrapResponseSchema>;
export type MobilePermission = z.infer<typeof mobilePermissionSchema>;
export type MobileOrderStatus = z.infer<typeof mobileOrderStatusSchema>;
export type MobileOrderListResponse = z.infer<typeof mobileOrderListResponseSchema>;
export type MobileOrderDetailResponse = z.infer<typeof mobileOrderDetailResponseSchema>;
export type MobileDashboardResponse = z.infer<typeof mobileDashboardResponseSchema>;
export type MobileLocalLabPersona = z.infer<typeof mobileLocalLabPersonaSchema>;
export type MobileLocalLabSectionId = z.infer<typeof mobileLocalLabSectionIdSchema>;
export type MobileLocalLabActionType = z.infer<typeof mobileLocalLabActionTypeSchema>;
export type MobileLocalLabResponse = z.infer<typeof mobileLocalLabResponseSchema>;
export type MobileLocalLabActionRequest = z.infer<typeof mobileLocalLabActionRequestSchema>;
export type MobileLocalLabActionResponse = z.infer<typeof mobileLocalLabActionResponseSchema>;
