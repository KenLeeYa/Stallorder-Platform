import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isQrLocale } from "@/lib/qr-order-i18n";
export { stallModuleCommandSchema } from "@/lib/stall-module-contract";

export async function getStallModuleState(stallId: string, organizationId: string) {
  const [settings, floors, tables, paymentOptions, discounts, lotteryDiscountChances] = await Promise.all([
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
    prisma.diningFloor.findMany({
      where: { stallId, organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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
    prisma.$queryRaw<Array<{ discountOptionId: string; winRateBps: number }>>(Prisma.sql`
      select
        chance.discount_option_id as "discountOptionId",
        chance.win_rate_bps::integer as "winRateBps"
      from public.stall_lottery_discount_chances chance
      where chance.stall_id = ${stallId}::uuid
    `),
  ]);

  const discountOrder = new Map(discounts.flatMap((discount, index) => (
    discount.isEnabled ? [[discount.id, index] as const] : []
  )));
  const orderedLotteryDiscountChances = lotteryDiscountChances
    .filter((chance) => discountOrder.has(chance.discountOptionId))
    .sort((left, right) => (
      (discountOrder.get(left.discountOptionId) ?? Number.MAX_SAFE_INTEGER)
      - (discountOrder.get(right.discountOptionId) ?? Number.MAX_SAFE_INTEGER)
    ));
  const legacyLotteryDiscountChances = settings.lotteryDiscountOptionId
    && settings.lotteryDiscountWinRateBps > 0
    && discountOrder.has(settings.lotteryDiscountOptionId)
    ? [{
        discountOptionId: settings.lotteryDiscountOptionId,
        winRateBps: settings.lotteryDiscountWinRateBps,
      }]
    : [];

  return {
    settings: {
      ...settings,
      lotteryDiscountChances: orderedLotteryDiscountChances.length > 0
        ? orderedLotteryDiscountChances
        : legacyLotteryDiscountChances,
      preorderSlotMinutes: ([5, 15, 30, 60, 120] as const).includes(
        settings.preorderSlotMinutes as 5 | 15 | 30 | 60 | 120,
      )
        ? settings.preorderSlotMinutes as 5 | 15 | 30 | 60 | 120
        : 30,
      enabledLocales: settings.enabledLocales.filter(isQrLocale),
    },
    floors,
    tables: tables.map(({ qrCodes, ...table }) => ({ ...table, qrCode: qrCodes[0] ?? null })),
    paymentOptions,
    discounts,
  };
}
