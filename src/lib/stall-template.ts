import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const stallTemplateSections = [
  "PAYMENTS",
  "DISCOUNTS",
  "ORDERING_EXPERIENCE",
  "PRODUCT_AVAILABILITY",
  "BUSINESS_HOURS",
] as const;
export type StallTemplateSection = (typeof stallTemplateSections)[number];

export const applyStallTemplateSchema = z.object({
  sourceStallId: z.string().uuid(),
  sections: z.array(z.enum(stallTemplateSections)).min(1).max(stallTemplateSections.length)
    .refine((items) => new Set(items).size === items.length, "範本項目不可重複。"),
}).strict();

export async function loadStallTemplateData(stallId: string, organizationId: string) {
  const [stall, paymentOptions, discounts, stallProducts, businessHours, settings, lotteryDiscountChances] = await Promise.all([
    prisma.stall.findFirstOrThrow({ where: { id: stallId, organizationId }, select: { id: true, name: true } }),
    prisma.paymentOption.findMany({ where: { stallId, organizationId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.discountOption.findMany({ where: { stallId, organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.stallProduct.findMany({
      where: { stallId, organizationId },
      orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
      include: { product: { select: { name: true } } },
    }),
    prisma.stallBusinessHour.findMany({ where: { stallId, organizationId }, orderBy: { dayOfWeek: "asc" } }),
    prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId },
      select: {
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        staffDeliveryEnabled: true,
        takeoutPreorderEnabled: true,
        preorderMinLeadMinutes: true,
        preorderMaxDays: true,
        preorderSlotMinutes: true,
        lotteryEnabled: true,
        lotteryDiscountOptionId: true,
        lotteryDiscountWinRateBps: true,
      },
    }),
    prisma.$queryRaw<Array<{ discountOptionId: string; winRateBps: number }>>`
      select
        chance.discount_option_id as "discountOptionId",
        chance.win_rate_bps::integer as "winRateBps"
      from public.stall_lottery_discount_chances chance
      join public.discount_options discount
        on discount.id = chance.discount_option_id
       and discount.stall_id = chance.stall_id
       and discount.is_enabled
      where chance.stall_id = ${stallId}::uuid
      order by discount.sort_order, discount.id
    `,
  ]);
  return {
    stall,
    paymentOptions,
    discounts,
    stallProducts,
    businessHours,
    settings,
    lotteryDiscountChances: lotteryDiscountChances.length > 0
      ? lotteryDiscountChances
      : settings.lotteryDiscountOptionId && settings.lotteryDiscountWinRateBps > 0
        && discounts.some((discount) => (
          discount.id === settings.lotteryDiscountOptionId && discount.isEnabled
        ))
        ? [{
            discountOptionId: settings.lotteryDiscountOptionId,
            winRateBps: settings.lotteryDiscountWinRateBps,
          }]
        : [],
  };
}

export async function getStallTemplatePreview(sourceStallId: string, targetStallId: string, organizationId: string) {
  const [source, target] = await Promise.all([
    loadStallTemplateData(sourceStallId, organizationId),
    loadStallTemplateData(targetStallId, organizationId),
  ]);
  return {
    sourceStall: source.stall,
    targetStall: target.stall,
    sections: [
      createSection("PAYMENTS", "付款方式", paymentDiff(source, target), source.paymentOptions.length, target.paymentOptions.length),
      createSection("DISCOUNTS", "折扣設定", discountDiff(source, target), source.discounts.length, target.discounts.length),
      createSection(
        "ORDERING_EXPERIENCE",
        "點餐體驗",
        orderingExperienceDiff(source, target),
        orderingExperienceEnabledCount(source),
        orderingExperienceEnabledCount(target),
      ),
      createSection("PRODUCT_AVAILABILITY", "商品供應", productAvailabilityDiff(source, target), source.stallProducts.length, target.stallProducts.length),
      createSection("BUSINESS_HOURS", "營業時間", businessHourDiff(source, target), source.businessHours.length, target.businessHours.length),
    ],
  };
}

function createSection(key: StallTemplateSection, label: string, changes: string[], sourceCount: number, targetCount: number) {
  return { key, label, changed: changes.length > 0, sourceCount, targetCount, changes };
}

function paymentDiff(source: Awaited<ReturnType<typeof loadStallTemplateData>>, target: Awaited<ReturnType<typeof loadStallTemplateData>>) {
  const sourceMap = new Map(source.paymentOptions.map((option) => [option.code, option]));
  const targetMap = new Map(target.paymentOptions.map((option) => [option.code, option]));
  const changes = namedDiff(sourceMap, targetMap, (option) => `${option.name}|${option.kind}|${option.isEnabled}|${option.sortOrder}`);
  if (source.settings.paymentModuleEnabled !== target.settings.paymentModuleEnabled) changes.unshift(`模組開關：${target.settings.paymentModuleEnabled ? "開啟" : "關閉"} → ${source.settings.paymentModuleEnabled ? "開啟" : "關閉"}`);
  return changes;
}

function discountDiff(source: Awaited<ReturnType<typeof loadStallTemplateData>>, target: Awaited<ReturnType<typeof loadStallTemplateData>>) {
  const sourceMap = new Map(source.discounts.map((option) => [option.name, option]));
  const targetMap = new Map(target.discounts.map((option) => [option.name, option]));
  const changes = namedDiff(sourceMap, targetMap, (option) => `${option.rateBps}|${option.isEnabled}|${option.sortOrder}`);
  if (source.settings.discountModuleEnabled !== target.settings.discountModuleEnabled) changes.unshift(`模組開關：${target.settings.discountModuleEnabled ? "開啟" : "關閉"} → ${source.settings.discountModuleEnabled ? "開啟" : "關閉"}`);
  if (source.settings.discountApprovalThresholdBps !== target.settings.discountApprovalThresholdBps) {
    changes.unshift(`經理核准門檻：${formatDiscount(source.settings.discountApprovalThresholdBps)}以下`);
  }
  return changes;
}

function orderingExperienceDiff(
  source: Awaited<ReturnType<typeof loadStallTemplateData>>,
  target: Awaited<ReturnType<typeof loadStallTemplateData>>,
) {
  const sourceDiscounts = lotteryPrizeSummary(source);
  const targetDiscounts = lotteryPrizeSummary(target);
  const values = [
    ["店員外送", enabledLabel(source.settings.staffDeliveryEnabled), enabledLabel(target.settings.staffDeliveryEnabled)],
    ["外帶預約", enabledLabel(source.settings.takeoutPreorderEnabled), enabledLabel(target.settings.takeoutPreorderEnabled)],
    ["最少提前", `${source.settings.preorderMinLeadMinutes} 分鐘`, `${target.settings.preorderMinLeadMinutes} 分鐘`],
    ["最多預約", `${source.settings.preorderMaxDays} 天`, `${target.settings.preorderMaxDays} 天`],
    ["時段間隔", `${source.settings.preorderSlotMinutes} 分鐘`, `${target.settings.preorderSlotMinutes} 分鐘`],
    ["抽抽樂", enabledLabel(source.settings.lotteryEnabled), enabledLabel(target.settings.lotteryEnabled)],
    ["折扣獎項", sourceDiscounts, targetDiscounts],
  ];
  return values
    .filter(([, sourceValue, targetValue]) => sourceValue !== targetValue)
    .map(([label, sourceValue, targetValue]) => `${label}：${targetValue} → ${sourceValue}`);
}

function lotteryPrizeSummary(data: Awaited<ReturnType<typeof loadStallTemplateData>>) {
  const prizes = data.lotteryDiscountChances.flatMap((chance) => {
    const discount = data.discounts.find((item) => (
      item.id === chance.discountOptionId && item.isEnabled
    ));
    return discount ? [`${discount.name} ${formatPercentage(chance.winRateBps)}`] : [];
  });
  const totalBps = data.lotteryDiscountChances.reduce(
    (total, chance) => total + chance.winRateBps,
    0,
  );
  const remainder = Math.max(0, 10_000 - totalBps);
  return [
    ...(prizes.length > 0 ? prizes : ["無折扣獎項"]),
    `未中獎／只推薦 ${formatPercentage(remainder)}`,
  ].join("、");
}

function orderingExperienceEnabledCount(data: Awaited<ReturnType<typeof loadStallTemplateData>>) {
  return [
    data.settings.staffDeliveryEnabled,
    data.settings.takeoutPreorderEnabled,
    data.settings.lotteryEnabled,
  ].filter(Boolean).length;
}

function enabledLabel(value: boolean) {
  return value ? "啟用" : "停用";
}

function formatDiscount(rateBps: number) {
  return `${Number((rateBps / 1000).toFixed(1))} 折`;
}

function formatPercentage(rateBps: number) {
  return `${Number((rateBps / 100).toFixed(2))}%`;
}

function productAvailabilityDiff(source: Awaited<ReturnType<typeof loadStallTemplateData>>, target: Awaited<ReturnType<typeof loadStallTemplateData>>) {
  const sourceMap = new Map(source.stallProducts.map((item) => [item.productId, item]));
  const targetMap = new Map(target.stallProducts.map((item) => [item.productId, item]));
  return namedDiff(sourceMap, targetMap, (item) => [
    item.priceOverride,
    item.isEnabled,
    item.isSoldOut,
    item.availableFrom?.toISOString() ?? null,
    item.availableUntil?.toISOString() ?? null,
    item.sortOrder,
  ].join("|"), (item) => item.product.name);
}

function businessHourDiff(source: Awaited<ReturnType<typeof loadStallTemplateData>>, target: Awaited<ReturnType<typeof loadStallTemplateData>>) {
  const sourceMap = new Map(source.businessHours.map((hour) => [String(hour.dayOfWeek), hour]));
  const targetMap = new Map(target.businessHours.map((hour) => [String(hour.dayOfWeek), hour]));
  return namedDiff(sourceMap, targetMap, (hour) => `${hour.opensAt}|${hour.closesAt}|${hour.isClosed}`, (hour) => `星期 ${hour.dayOfWeek}`);
}

function namedDiff<T>(
  source: Map<string, T>,
  target: Map<string, T>,
  signature: (value: T) => string,
  label: (value: T, key: string) => string = (_value, key) => key,
) {
  const changes: string[] = [];
  for (const [key, value] of source) {
    const current = target.get(key);
    if (!current) changes.push(`新增：${label(value, key)}`);
    else if (signature(value) !== signature(current)) changes.push(`更新：${label(value, key)}`);
  }
  for (const [key, value] of target) {
    if (!source.has(key)) changes.push(`移除或停用：${label(value, key)}`);
  }
  return changes;
}
