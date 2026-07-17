import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const PRINTER_OFFLINE_AFTER_MS = 90_000;

const uuid = z.string().uuid();
export const printQueueCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("REGISTER_PRINTER"), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ operation: z.literal("UPDATE_PRINTER"), printerId: uuid, name: z.string().trim().min(1).max(80), isEnabled: z.boolean() }).strict(),
  z.object({ operation: z.literal("HEARTBEAT"), printerId: uuid }).strict(),
  z.object({ operation: z.literal("QUEUE"), orderId: uuid }).strict(),
  z.object({ operation: z.literal("CLAIM"), jobId: uuid, printerId: uuid }).strict(),
  z.object({ operation: z.literal("SUCCESS"), jobId: uuid }).strict(),
  z.object({ operation: z.literal("FAIL"), jobId: uuid, error: z.string().trim().min(1).max(500) }).strict(),
  z.object({ operation: z.literal("RETRY"), jobId: uuid }).strict(),
  z.object({ operation: z.literal("REPRINT"), jobId: uuid }).strict(),
  z.object({ operation: z.literal("CANCEL"), jobId: uuid }).strict(),
]);

export async function getPrintQueueState(stallId: string, organizationId: string) {
  const [settings, printers, jobs] = await Promise.all([
    prisma.stallOrderingSettings.findFirst({
      where: { stallId, organizationId },
      select: { printModuleEnabled: true },
    }),
    prisma.printer.findMany({
      where: { stallId, organizationId },
      orderBy: [{ isEnabled: "desc" }, { name: "asc" }],
    }),
    prisma.printJob.findMany({
      where: { stallId, organizationId },
      orderBy: { queuedAt: "desc" },
      take: 100,
      include: {
        printer: { select: { id: true, name: true, lastSeenAt: true, isEnabled: true } },
        order: {
          select: {
            id: true,
            orderNo: true,
            customerName: true,
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
  ]);
  const offlineBefore = Date.now() - PRINTER_OFFLINE_AFTER_MS;
  return {
    printModuleEnabled: settings?.printModuleEnabled ?? false,
    printers: printers.map((printer) => ({
      ...printer,
      isOnline: printer.isEnabled && Boolean(printer.lastSeenAt && printer.lastSeenAt.getTime() >= offlineBefore),
    })),
    jobs,
  };
}
