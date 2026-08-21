import "server-only";

import { Prisma } from "@prisma/client";
import {
  createCustomerReceiptPayload,
  createKitchenTicketBatchPayload,
  printTicketPayloadSchema,
  type KitchenTicketInput,
  type PrintFontScale,
  type PrintPaperWidth,
} from "@/lib/kitchen-print-ticket";
import { prisma } from "@/lib/prisma";

export const printJobTicketSelect = {
  id: true,
  reprintOfId: true,
  isRoutingCopy: true,
  payload: true,
  copies: true,
  documentType: true,
  printer: { select: { paperWidthMm: true } },
  printRule: {
    select: {
      productCategoryIds: true,
      productGroupIds: true,
      fontScale: true,
      splitMode: true,
      aggregateItems: true,
    },
  },
  stall: { select: { name: true, timezone: true, currency: true } },
  order: {
    select: {
      orderNo: true,
      fulfillmentType: true,
      tableLabel: true,
      customerName: true,
      customerPhone: true,
      deliveryAddress: true,
      note: true,
      createdAt: true,
      scheduledPickupAt: true,
      requestedFulfillmentAt: true,
      committedFulfillmentAt: true,
      subtotal: true,
      discountAmount: true,
      total: true,
      paymentStatus: true,
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productId: true,
          name: true,
          quantity: true,
          unitPrice: true,
          note: true,
          noteOptions: {
            orderBy: { id: "asc" },
            select: { optionName: true },
          },
          product: {
            select: {
              categoryId: true,
              groupId: true,
              category: { select: { name: true } },
              group: { select: { name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PrintJobSelect;

type PrintJobTicket = Prisma.PrintJobGetPayload<{ select: typeof printJobTicketSelect }>;
type TicketItem = NonNullable<PrintJobTicket["order"]>["items"][number];

export async function resolvePrintJobTicketPayload(job: PrintJobTicket) {
  const stored = printTicketPayloadSchema.safeParse(job.payload);
  if (stored.success) return stored.data;
  if (!job.order) throw new Error("Order print job has no order or immutable payload");

  const paperWidthMm = normalizePaperWidth(job.printer?.paperWidthMm);
  const fontScale = normalizeFontScale(job.printRule?.fontScale);
  const copies = normalizeCopies(job.copies);
  const filteredItems = filterTicketItems(job.order.items, job.printRule);
  const items = job.printRule?.aggregateItems ? aggregateTicketItems(filteredItems) : filteredItems;
  if (items.length === 0) throw new Error("Print rule selected no order items");

  const payload = job.documentType === "CUSTOMER_RECEIPT"
    ? createCustomerReceiptPayload({
        stallName: job.stall.name,
        timeZone: job.stall.timezone,
        currency: job.stall.currency,
        printedAt: new Date(),
        isReprint: Boolean(job.reprintOfId && !job.isRoutingCopy),
        paperWidthMm,
        fontScale,
        copies,
        order: {
          ...job.order,
          items: items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            note: item.note,
            noteOptions: item.noteOptions,
          })),
        },
      })
    : createKitchenTicketBatchPayload({
        stallName: job.stall.name,
        timeZone: job.stall.timezone,
        printedAt: new Date(),
        isReprint: Boolean(job.reprintOfId && !job.isRoutingCopy),
        paperWidthMm,
        fontScale,
        order: {
          orderNo: job.order.orderNo,
          fulfillmentType: job.order.fulfillmentType,
          tableLabel: job.order.tableLabel,
          note: job.order.note,
          createdAt: job.order.createdAt,
          scheduledPickupAt: job.order.scheduledPickupAt,
          requestedFulfillmentAt: job.order.requestedFulfillmentAt,
          committedFulfillmentAt: job.order.committedFulfillmentAt,
        },
        sections: splitTicketItems(items, job.printRule?.splitMode ?? "NONE").map((section) => ({
          label: section.label,
          items: section.items.map(kitchenItem),
        })),
      }, copies);

  return persistPayload(job.id, job.payload, payload);
}

function filterTicketItems(
  items: TicketItem[],
  rule: PrintJobTicket["printRule"],
) {
  if (!rule || (rule.productCategoryIds.length === 0 && rule.productGroupIds.length === 0)) return items;
  const categoryIds = new Set(rule.productCategoryIds);
  const groupIds = new Set(rule.productGroupIds);
  return items.filter((item) => Boolean(
    (item.product?.categoryId && categoryIds.has(item.product.categoryId))
    || (item.product?.groupId && groupIds.has(item.product.groupId)),
  ));
}

function aggregateTicketItems(items: TicketItem[]) {
  const aggregated = new Map<string, TicketItem>();
  for (const item of items) {
    const key = JSON.stringify([
      item.productId ?? item.name,
      item.unitPrice,
      item.note,
      item.noteOptions.map((option) => option.optionName),
    ]);
    const existing = aggregated.get(key);
    if (existing) {
      aggregated.set(key, { ...existing, quantity: existing.quantity + item.quantity });
    } else {
      aggregated.set(key, item);
    }
  }
  return [...aggregated.values()];
}

function splitTicketItems(items: TicketItem[], mode: "NONE" | "CATEGORY" | "PRODUCT" | "ITEM") {
  if (mode === "NONE") return [{ label: null, items }];
  if (mode === "ITEM") {
    return items.map((item, index) => ({ label: `品項 ${index + 1}/${items.length}`, items: [item] }));
  }
  const groups = new Map<string, { label: string; items: TicketItem[] }>();
  for (const item of items) {
    const key = mode === "CATEGORY"
      ? item.product?.categoryId ?? "uncategorized"
      : item.productId ?? `snapshot:${item.name}`;
    const label = mode === "CATEGORY"
      ? item.product?.category.name ?? "未分類"
      : item.name;
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function kitchenItem(item: TicketItem): KitchenTicketInput["order"]["items"][number] {
  return {
    name: item.name,
    quantity: item.quantity,
    note: item.note,
    noteOptions: item.noteOptions,
  };
}

function normalizePaperWidth(value: number | undefined): PrintPaperWidth {
  return value === 80 ? 80 : 58;
}

function normalizeFontScale(value: number | undefined): PrintFontScale {
  return value === 2 || value === 3 ? value : 1;
}

function normalizeCopies(value: number | undefined) {
  return typeof value === "number" && value >= 1 && value <= 5 ? value : 1;
}

async function persistPayload(
  jobId: string,
  currentPayload: Prisma.JsonValue | null,
  payload: ReturnType<typeof createKitchenTicketBatchPayload> | ReturnType<typeof createCustomerReceiptPayload>,
) {
  if (currentPayload === null) {
    const persisted = await prisma.printJob.updateMany({
      where: { id: jobId, payload: { equals: Prisma.DbNull } },
      data: {
        payload: payload as Prisma.InputJsonValue,
        templateVersion: payload.version,
      },
    });
    if (persisted.count === 1) return payload;
    const concurrent = await prisma.printJob.findUnique({
      where: { id: jobId },
      select: { payload: true },
    });
    const concurrentPayload = printTicketPayloadSchema.safeParse(concurrent?.payload);
    if (concurrentPayload.success) return concurrentPayload.data;
    throw new Error("Print job payload persistence conflict");
  }

  await prisma.printJob.update({
    where: { id: jobId },
    data: {
      payload: payload as Prisma.InputJsonValue,
      templateVersion: payload.version,
    },
  });
  return payload;
}
