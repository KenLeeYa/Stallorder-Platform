import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isQrLocale } from "@/lib/qr-order-i18n";
export { stallModuleCommandSchema } from "@/lib/stall-module-contract";

export async function getStallModuleState(stallId: string, organizationId: string) {
  const [settings, floors, tables, paymentOptions, discounts, lotteryDiscountChances, upsellProducts] = await Promise.all([
    prisma.stallOrderingSettings.findFirstOrThrow({
      where: { stallId, organizationId },
      select: {
        dineInEnabled: true,
        deliveryModuleEnabled: true,
        deliveryCustomerNotice: true,
        staffDeliveryEnabled: true,
        printModuleEnabled: true,
        kdsModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        takeoutPreorderEnabled: true,
        checkoutUpsellEnabled: true,
        checkoutUpsellProductIds: true,
        preorderMinLeadMinutes: true,
        preorderMaxDays: true,
        preorderSlotMinutes: true,
        lotteryEnabled: true,
        lotteryDiscountOptionId: true,
        lotteryDiscountWinRateBps: true,
        lotterySpendRewardEnabled: true,
        lotterySpendThresholdAmount: true,
        lotteryFestivalRewardEnabled: true,
        lotteryFestivalStartsOn: true,
        lotteryFestivalEndsOn: true,
        lotteryBirthdayRewardEnabled: true,
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
    prisma.stallProduct.findMany({
      where: {
        stallId,
        organizationId,
        product: { isActive: true },
      },
      orderBy: [{ sortOrder: "asc" }, { product: { sortOrder: "asc" } }, { product: { name: "asc" } }],
      select: {
        productId: true,
        priceOverride: true,
        isEnabled: true,
        isSoldOut: true,
        product: {
          select: {
            name: true,
            defaultPrice: true,
            translations: { select: { locale: true, name: true } },
          },
        },
      },
    }),
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
      lotteryFestivalStartsOn: settings.lotteryFestivalStartsOn?.toISOString().slice(0, 10) ?? null,
      lotteryFestivalEndsOn: settings.lotteryFestivalEndsOn?.toISOString().slice(0, 10) ?? null,
      preorderSlotMinutes: ([5, 15, 30, 60, 120] as const).includes(
        settings.preorderSlotMinutes as 5 | 15 | 30 | 60 | 120,
      )
        ? settings.preorderSlotMinutes as 5 | 15 | 30 | 60 | 120
        : 30,
      enabledLocales: settings.enabledLocales.filter(isQrLocale),
    },
    floors,
    tables: tables.map(({ qrCodes, ...table }) => ({ ...table, qrCode: qrCodes[0] ?? null })),
    upsellProducts: upsellProducts.map((assignment) => ({
      id: assignment.productId,
      name: assignment.product.name,
      price: assignment.priceOverride ?? assignment.product.defaultPrice,
      isAvailable: assignment.isEnabled && !assignment.isSoldOut,
      translations: assignment.product.translations,
    })),
    paymentOptions,
    discounts,
  };
}
