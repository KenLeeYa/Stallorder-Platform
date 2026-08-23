import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const PRINTER_OFFLINE_AFTER_MS = 90_000;
export const PRINT_RESULT_UNKNOWN_AFTER_MS = 5 * 60_000;

const uuid = z.string().uuid();
const printerConnectionType = z.enum(["WEBPRNT_BLUETOOTH", "CLOUDPRNT", "SYSTEM_PRINT"]);
const paperWidthMm = z.union([z.literal(58), z.literal(80)]);
const orderSource = z.enum(["QR_MENU", "STAFF_POS", "LINE_DELIVERY", "OFFLINE_POS"]);
const orderOrigin = z.enum(["ONLINE_QR", "ONLINE_STAFF", "OFFLINE_POS", "IMPORTED"]);
const fulfillmentType = z.enum(["TAKEOUT", "DINE_IN", "DELIVERY"]);
const documentType = z.enum(["KITCHEN_TICKET", "CUSTOMER_RECEIPT"]);
const printTrigger = z.enum(["ORDER_CONFIRMED", "PAYMENT_COMPLETED"]);
const splitMode = z.enum(["NONE", "CATEGORY", "PRODUCT", "ITEM"]);

const printerConfiguration = {
  name: z.string().trim().min(1).max(80),
  connectionType: printerConnectionType,
  model: z.string().trim().min(1).max(40),
  paperWidthMm,
  autoDetectEnabled: z.boolean(),
  openCashDrawerOnCashPayment: z.boolean(),
};

const printRuleConfiguration = z.object({
  name: z.string().trim().min(1).max(80),
  printerId: uuid,
  isEnabled: z.boolean(),
  documentType,
  trigger: printTrigger,
  orderSources: z.array(orderSource).max(12),
  orderOrigins: z.array(orderOrigin).max(6),
  fulfillmentTypes: z.array(fulfillmentType).max(3),
  productCategoryIds: z.array(uuid).max(100),
  productGroupIds: z.array(uuid).max(200),
  copies: z.number().int().min(1).max(5),
  fontScale: z.number().int().min(1).max(3),
  splitMode,
  aggregateItems: z.boolean(),
  autoPrint: z.boolean(),
  showCustomerName: z.boolean().default(true),
  showCustomerPhone: z.boolean().default(true),
  showDeliveryAddress: z.boolean().default(true),
  showOrderNote: z.boolean().default(true),
  showItemNotes: z.boolean().default(true),
  showPrices: z.boolean().default(true),
  showPaymentMethod: z.boolean().default(true),
  feedLines: z.number().int().min(1).max(3).default(2),
  sortOrder: z.number().int().min(0).max(1000),
}).strict().superRefine((value, context) => {
  if (value.documentType === "CUSTOMER_RECEIPT" && value.splitMode !== "NONE") {
    context.addIssue({ code: "custom", path: ["splitMode"], message: "顧客明細不可依品項切單。" });
  }
  if (value.documentType === "CUSTOMER_RECEIPT"
      && (value.productCategoryIds.length > 0 || value.productGroupIds.length > 0)) {
    context.addIssue({ code: "custom", path: ["documentType"], message: "顧客明細必須包含完整訂單。" });
  }
});

export const printQueueCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("REFRESH") }).strict(),
  z.object({
    operation: z.literal("REGISTER_PRINTER"),
    name: printerConfiguration.name,
    connectionType: printerConfiguration.connectionType.default("WEBPRNT_BLUETOOTH"),
    model: printerConfiguration.model.default("MCP31LB"),
    paperWidthMm: printerConfiguration.paperWidthMm.default(58),
    autoDetectEnabled: printerConfiguration.autoDetectEnabled.default(true),
    openCashDrawerOnCashPayment: printerConfiguration.openCashDrawerOnCashPayment.default(false),
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_PRINTER"),
    printerId: uuid,
    name: printerConfiguration.name,
    isEnabled: z.boolean(),
    connectionType: printerConfiguration.connectionType.optional(),
    model: printerConfiguration.model.optional(),
    paperWidthMm: printerConfiguration.paperWidthMm.optional(),
    autoDetectEnabled: printerConfiguration.autoDetectEnabled.optional(),
    openCashDrawerOnCashPayment: printerConfiguration.openCashDrawerOnCashPayment.optional(),
  }).strict(),
  z.object({ operation: z.literal("HEARTBEAT"), printerId: uuid }).strict(),
  z.object({ operation: z.literal("TEST_PRINTER"), printerId: uuid }).strict(),
  z.object({
    operation: z.literal("AUTHORIZE_CASH_DRAWER"),
    printerId: uuid,
    managerAuthorizationCode: z.string().trim().regex(/^\d{4,8}$/).optional(),
  }).strict(),
  z.object({ operation: z.literal("CREATE_RULE"), rule: printRuleConfiguration }).strict(),
  z.object({ operation: z.literal("UPDATE_RULE"), ruleId: uuid, rule: printRuleConfiguration }).strict(),
  z.object({ operation: z.literal("DELETE_RULE"), ruleId: uuid }).strict(),
  z.object({ operation: z.literal("QUEUE"), orderId: uuid }).strict(),
  z.object({ operation: z.literal("QUEUE_RECEIPT"), orderId: uuid }).strict(),
  z.object({ operation: z.literal("CLAIM"), jobId: uuid, printerId: uuid }).strict(),
  z.object({ operation: z.literal("SUCCESS"), jobId: uuid }).strict(),
  z.object({ operation: z.literal("FAIL"), jobId: uuid, error: z.string().trim().min(1).max(500) }).strict(),
  z.object({ operation: z.literal("RETRY"), jobId: uuid }).strict(),
  z.object({ operation: z.literal("REPRINT"), jobId: uuid }).strict(),
  z.object({ operation: z.literal("CANCEL"), jobId: uuid }).strict(),
]);

export async function reconcileStalePrintJobs(stallId: string, organizationId: string) {
  return prisma.printJob.updateMany({
    where: {
      stallId,
      organizationId,
      status: "PRINTING",
      printingAt: { lt: new Date(Date.now() - PRINT_RESULT_UNKNOWN_AFTER_MS) },
    },
    data: {
      status: "FAILED",
      lastError: "PRINT_RESULT_UNKNOWN",
      nextRetryAt: null,
    },
  });
}

export async function getPrintQueueState(stallId: string, organizationId: string) {
  const [settings, printers, rules, jobs, categories] = await Promise.all([
    prisma.stallOrderingSettings.findFirst({
      where: { stallId, organizationId },
      select: { printModuleEnabled: true },
    }),
    prisma.printer.findMany({
      where: { stallId, organizationId },
      orderBy: [{ isEnabled: "desc" }, { name: "asc" }],
    }),
    prisma.printRule.findMany({
      where: { stallId, organizationId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { printer: { select: { id: true, name: true, isEnabled: true } } },
    }),
    prisma.printJob.findMany({
      where: { stallId, organizationId },
      orderBy: { queuedAt: "desc" },
      take: 100,
      include: {
        printer: {
          select: {
            id: true,
            name: true,
            lastSeenAt: true,
            isEnabled: true,
            connectionType: true,
          },
        },
        printRule: { select: { id: true, name: true, autoPrint: true } },
        order: {
          select: {
            id: true,
            orderNo: true,
            customerName: true,
            customerPhone: true,
            deliveryAddress: true,
            tableLabel: true,
            fulfillmentType: true,
            total: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                name: true,
                quantity: true,
                note: true,
                noteOptions: { select: { groupName: true, optionName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.productCategory.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        groups: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true },
        },
      },
    }),
  ]);
  const offlineBefore = Date.now() - PRINTER_OFFLINE_AFTER_MS;
  return {
    printModuleEnabled: settings?.printModuleEnabled ?? false,
    printers: printers.map((printer) => ({
      ...printer,
      isOnline: printer.isEnabled && Boolean(
        printer.lastSeenAt && printer.lastSeenAt.getTime() >= offlineBefore,
      ),
    })),
    rules,
    catalog: categories,
    jobs,
  };
}
