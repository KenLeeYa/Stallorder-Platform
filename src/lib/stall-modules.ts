import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isQrLocale, QR_LOCALES } from "@/lib/qr-order-i18n";

const uuid = z.string().uuid();
const floorCoordinate = z.number().int().min(0).max(820);
const tableFields = {
  code: z.string().trim().min(1).max(20).regex(/^[A-Z0-9-]+$/),
  label: z.string().trim().min(1).max(40),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};
const paymentFields = {
  code: z.string().trim().min(1).max(30).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(50),
  kind: z.enum(["CASH", "LINE_PAY", "JKO_PAY", "CUSTOM"]),
  isEnabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
};
const discountFields = {
  name: z.string().trim().min(1).max(50),
  rateBps: z.number().int().min(1).max(10_000),
  isEnabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
};

export const stallModuleCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("UPDATE_MODULES"),
    dineInEnabled: z.boolean(),
    deliveryModuleEnabled: z.boolean(),
    printModuleEnabled: z.boolean(),
    paymentModuleEnabled: z.boolean(),
    discountModuleEnabled: z.boolean(),
    discountApprovalThresholdBps: z.number().int().min(0).max(10_000),
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_LOCALES"),
    enabledLocales: z.array(z.enum(QR_LOCALES)).min(1).max(QR_LOCALES.length)
      .refine((locales) => locales.includes("zh-TW"), "繁體中文必須保持啟用")
      .refine((locales) => new Set(locales).size === locales.length, "語系不可重複"),
  }).strict(),
  z.object({ operation: z.literal("CREATE_TABLE"), ...tableFields }).strict(),
  z.object({ operation: z.literal("UPDATE_TABLE"), tableId: uuid, ...tableFields }).strict(),
  z.object({
    operation: z.literal("UPDATE_TABLE_LAYOUT"),
    tables: z.array(z.object({
      tableId: uuid,
      layoutX: floorCoordinate,
      layoutY: floorCoordinate,
    }).strict()).min(1).max(100)
      .refine((tables) => new Set(tables.map((table) => table.tableId)).size === tables.length, "桌位不可重複"),
  }).strict(),
  z.object({ operation: z.literal("DELETE_TABLE"), tableId: uuid }).strict(),
  z.object({ operation: z.literal("ROTATE_TABLE_QR"), tableId: uuid }).strict(),
  z.object({ operation: z.literal("CREATE_PAYMENT_OPTION"), ...paymentFields }).strict(),
  z.object({ operation: z.literal("UPDATE_PAYMENT_OPTION"), paymentOptionId: uuid, ...paymentFields }).strict(),
  z.object({ operation: z.literal("DELETE_PAYMENT_OPTION"), paymentOptionId: uuid }).strict(),
  z.object({ operation: z.literal("CREATE_DISCOUNT"), ...discountFields }).strict(),
  z.object({ operation: z.literal("UPDATE_DISCOUNT"), discountId: uuid, ...discountFields }).strict(),
  z.object({ operation: z.literal("DELETE_DISCOUNT"), discountId: uuid }).strict(),
]);

export async function getStallModuleState(stallId: string, organizationId: string) {
  const [settings, tables, paymentOptions, discounts] = await Promise.all([
    prisma.stallOrderingSettings.findFirstOrThrow({
      where: { stallId, organizationId },
      select: {
        dineInEnabled: true,
        deliveryModuleEnabled: true,
        printModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        enabledLocales: true,
      },
    }),
    prisma.diningTable.findMany({
      where: { stallId, organizationId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      include: {
        qrCodes: {
          where: { state: "ACTIVE" },
          orderBy: { tokenVersion: "desc" },
          take: 1,
          select: { id: true, token: true, state: true, tokenVersion: true },
        },
      },
    }),
    prisma.paymentOption.findMany({
      where: { stallId, organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.discountOption.findMany({
      where: { stallId, organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return {
    settings: {
      ...settings,
      enabledLocales: settings.enabledLocales.filter(isQrLocale),
    },
    tables: tables.map(({ qrCodes, ...table }) => ({ ...table, qrCode: qrCodes[0] ?? null })),
    paymentOptions,
    discounts,
  };
}
