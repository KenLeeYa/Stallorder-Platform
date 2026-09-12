import "server-only";
import { Prisma } from "@prisma/client";
import { createKitchenTicketBatchPayload, printTicketPayloadSchema, type KitchenTicketInput } from "@/lib/kitchen-print-ticket";
import { printJobTicketSelect, resolvePrintJobTicketPayload } from "./print-job-ticket";

export type AmendmentItem = KitchenTicketInput["order"]["items"][number] & {
  id: string; productId: string | null; unitPrice: number;
  product: { categoryId: string; groupId: string | null } | null;
};

export function getOrderItemChanges(before: AmendmentItem[], after: AmendmentItem[]) {
  const oldItems = new Map(before.map((item) => [item.id, item]));
  const newItems = new Map(after.map((item) => [item.id, item]));
  return {
    removed: before.flatMap((item) => {
      const quantity = item.quantity - (newItems.get(item.id)?.quantity ?? 0);
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }),
    added: after.flatMap((item) => {
      const quantity = item.quantity - (oldItems.get(item.id)?.quantity ?? 0);
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }),
  };
}

export async function freezeOrderPrintDocuments(transaction: Prisma.TransactionClient, orderId: string) {
  const jobs = await transaction.printJob.findMany({
    where: { orderId, NOT: { status: "CANCELLED", attemptCount: 0 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { ...printJobTicketSelect, printerId: true, printRuleId: true, status: true, attemptCount: true },
  });
  for (const job of jobs) job.payload = await resolvePrintJobTicketPayload(job, transaction);
  return jobs;
}

type OriginalJob = Awaited<ReturnType<typeof freezeOrderPrintDocuments>>[number];

export async function queueOrderAmendmentPrints(transaction: Prisma.TransactionClient, input: {
  organizationId: string; stallId: string; actorProfileId: string; amendmentId: string; number: number;
  originalJobs: OriginalJob[]; before: AmendmentItem[]; after: AmendmentItem[];
  order: { id: string; source: string; origin: string; fulfillmentType: string; total: number };
}) {
  const template = input.originalJobs[0];
  if (!template?.order) return;
  const changes = getOrderItemChanges(input.before, input.after);
  if (!changes.removed.length && !changes.added.length) return;
  const rules = await transaction.printRule.findMany({
    where: { organizationId: input.organizationId, stallId: input.stallId, isEnabled: true, deletedAt: null, trigger: "ORDER_CONFIRMED", printer: { isEnabled: true } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { printer: { select: { paperWidthMm: true } } },
    take: 50,
  });
  const destinations = new Map<string, Pick<OriginalJob, "printerId" | "printRuleId" | "printRule" | "printer" | "documentType" | "copies">>();
  const destinationKey = (ruleId: string | null, printerId: string | null) => `${ruleId ?? "default"}:${printerId ?? "default"}`;
  const additionDestinations = new Set<string>();
  for (const job of input.originalJobs) {
    const key = destinationKey(job.printRuleId, job.printerId);
    destinations.set(key, job);
    if (!job.printRuleId && rules.length === 0) additionDestinations.add(key);
  }
  for (const rule of rules) {
    if ((rule.orderSources.length && !rule.orderSources.some((value) => value === input.order.source))
      || (rule.orderOrigins.length && !rule.orderOrigins.some((value) => value === input.order.origin))
      || (rule.fulfillmentTypes.length && !rule.fulfillmentTypes.some((value) => value === input.order.fulfillmentType))) continue;
    const key = destinationKey(rule.id, rule.printerId);
    destinations.set(key, { printerId: rule.printerId, printRuleId: rule.id, printRule: rule, printer: rule.printer, documentType: rule.documentType, copies: rule.copies });
    additionDestinations.add(key);
  }
  for (const destination of destinations.values()) {
    const matches = (item: AmendmentItem) => {
      const rule = destination.printRule;
      return !rule || (!rule.productCategoryIds.length && !rule.productGroupIds.length)
        || Boolean(item.product && (rule.productCategoryIds.includes(item.product.categoryId)
          || (item.product.groupId && rule.productGroupIds.includes(item.product.groupId))));
    };
    const original = input.originalJobs.filter((job) => job.printRuleId === destination.printRuleId && job.printerId === destination.printerId);
    const snapshots = original.map((job) => {
      const parsed = printTicketPayloadSchema.safeParse(job.payload);
      return parsed.success && "sourceItemIds" in parsed.data ? parsed.data.sourceItemIds : undefined;
    });
    const printedItemIds = snapshots.flatMap((ids) => ids ?? []);
    // Old tickets have no item IDs: notify their original destinations rather than silently miss a cancellation after a category move.
    const removed = changes.removed.filter((item) => original.length > 0 && (snapshots.some((ids) => ids === undefined) || printedItemIds.includes(item.id)));
    const added = additionDestinations.has(destinationKey(destination.printRuleId, destination.printerId)) ? changes.added.filter(matches) : [];
    if (!removed.length && !added.length) continue;
    const payload = createKitchenTicketBatchPayload({
      stallName: template.stall.name, timeZone: template.stall.timezone,
      documentTitle: `訂單變更單 #${input.number}`,
      printedAt: new Date(), isReprint: false,
      paperWidthMm: destination.printer?.paperWidthMm === 80 ? 80 : 58,
      fontScale: destination.printRule?.fontScale === 2 || destination.printRule?.fontScale === 3 ? destination.printRule.fontScale : 1,
      showItemNotes: true, showOrderNote: true,
      order: { ...template.order,
        note: `只處理本變更單列出的增減數量，其他餐點維持原單。變更後訂單金額：${input.order.total} ${template.stall.currency}`,
      },
      sections: [
        ...(removed.length ? [{ label: "刪除／減量，請勿製作", items: removed.map((item) => ({ ...item, name: `【勿製作】${item.name}` })) }] : []),
        ...(added.length ? [{ label: "新增／加量，請加做", items: added.map((item) => ({ ...item, name: `【加做】${item.name}` })) }] : []),
      ],
    }, destination.copies);
    await transaction.printJob.create({
      data: {
        organizationId: input.organizationId, stallId: input.stallId, orderId: input.order.id,
        amendmentId: input.amendmentId, requestedById: input.actorProfileId,
        printerId: destination.printerId, printRuleId: destination.printRuleId,
        documentType: destination.documentType, copies: destination.copies,
        payload: { ...payload, sourceItemIds: added.map((item) => item.id) } as Prisma.InputJsonValue, templateVersion: payload.version,
      },
    });
  }
}
