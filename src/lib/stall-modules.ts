import "server-only";

import { prisma } from "@/lib/prisma";
import { isQrLocale } from "@/lib/qr-order-i18n";
export { stallModuleCommandSchema } from "@/lib/stall-module-contract";

export async function getStallModuleState(stallId: string, organizationId: string) {
  const [settings, tables, paymentOptions, discounts] = await Promise.all([
    prisma.stallOrderingSettings.findFirstOrThrow({
      where: { stallId, organizationId },
      select: {
        dineInEnabled: true,
        deliveryModuleEnabled: true,
        staffDeliveryEnabled: true,
        printModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        takeoutPreorderEnabled: true,
        preorderMinLeadMinutes: true,
        preorderMaxDays: true,
        preorderSlotMinutes: true,
        lotteryEnabled: true,
        lotteryDiscountOptionId: true,
        lotteryDiscountWinRateBps: true,
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
      preorderSlotMinutes: ([15, 30, 60, 120] as const).includes(
        settings.preorderSlotMinutes as 15 | 30 | 60 | 120,
      )
        ? settings.preorderSlotMinutes as 15 | 30 | 60 | 120
        : 30,
      enabledLocales: settings.enabledLocales.filter(isQrLocale),
    },
    tables: tables.map(({ qrCodes, ...table }) => ({ ...table, qrCode: qrCodes[0] ?? null })),
    paymentOptions,
    discounts,
  };
}
