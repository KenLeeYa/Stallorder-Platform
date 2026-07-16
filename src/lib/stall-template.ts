import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const stallTemplateSections = ["PAYMENTS", "DISCOUNTS", "PRODUCT_AVAILABILITY", "BUSINESS_HOURS"] as const;
export type StallTemplateSection = (typeof stallTemplateSections)[number];

export const applyStallTemplateSchema = z.object({
  sourceStallId: z.string().uuid(),
  sections: z.array(z.enum(stallTemplateSections)).min(1).max(stallTemplateSections.length)
    .refine((items) => new Set(items).size === items.length, "範本項目不可重複。"),
}).strict();

export async function loadStallTemplateData(stallId: string, organizationId: string) {
  const [stall, paymentOptions, discounts, stallProducts, businessHours, settings] = await Promise.all([
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
      },
    }),
  ]);
  return { stall, paymentOptions, discounts, stallProducts, businessHours, settings };
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

function formatDiscount(rateBps: number) {
  return `${Number((rateBps / 1000).toFixed(1))} 折`;
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
