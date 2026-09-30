import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";
import { createResponsiveOrderFixture } from "./responsive-order-fixture";
import { generateResponsiveQrToken } from "../../scripts/responsive-qa-token.mjs";

export const acceptanceDirectory = "artifacts/ux-responsive-20260930/b3-accessibility";
export const fixedDataset = "responsive-b3-fixed-120-v1";
export const longProductName = "B3 超長名稱香酥雞排搭配香草與季節蔬菜 Long configuration with seasonal vegetables";
export const longProductNameEnglish = "B3 Crispy chicken with fragrant herbs and seasonal vegetables with a long configuration name";
export const longNote = "請將醬料分開包裝，並保留完整品項說明。Please keep the sauce separate and preserve this long instruction. ".repeat(4);
export const acceptanceWidths = [320, 360, 390, 768, 820, 1024, 1280, 1440];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const orderKey = (index: number) => {
  const value = hash(`${fixedDataset}-${index}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};

// Reuse without updating timestamps/status: B3.2 must measure the exact same data.
// Never delete/reset an existing order or regenerate this fixture on a retry.
export async function fixedAcceptanceFixture() {
  assertResponsiveQaTarget(process.env);
  const prisma = new PrismaClient();
  try {
    let product = await prisma.product.findFirst({ where: { description: fixedDataset } });
    if (!product) {
      const created = await createResponsiveOrderFixture(prisma);
      product = await prisma.product.update({ where: { id: created.productId }, data: {
        name: longProductName, description: fixedDataset,
      } });
      await prisma.qrCode.update({ where: { token: created.qrToken }, data: { label: fixedDataset } });
    }
    const qr = await prisma.qrCode.findFirstOrThrow({ where: { label: fixedDataset, state: "ACTIVE" } });
    mkdirSync(acceptanceDirectory, { recursive: true });
    const localeSettings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId: qr.stallId }, select: { enabledLocales: true } });
    if (!existsSync(`${acceptanceDirectory}/locale-fixture-before.json`)) writeFileSync(`${acceptanceDirectory}/locale-fixture-before.json`, JSON.stringify({ stallId: qr.stallId, ...localeSettings }));
    if (!localeSettings.enabledLocales.includes("en")) await prisma.stallOrderingSettings.update({ where: { stallId: qr.stallId }, data: { enabledLocales: [...localeSettings.enabledLocales, "en"] } });
    let category = await prisma.productCategory.findFirst({ where: { organizationId: qr.organizationId, name: fixedDataset } });
    if (!category) category = await prisma.productCategory.create({ data: { organizationId: qr.organizationId, name: fixedDataset } });
    if (product.categoryId !== category.id) await prisma.product.update({ where: { id: product.id }, data: { categoryId: category.id } });
    await prisma.productCategoryTranslation.upsert({ where: { categoryId_locale: { categoryId: category.id, locale: "en" } }, update: {}, create: { organizationId: qr.organizationId, categoryId: category.id, locale: "en", name: "B3 fixed acceptance menu" } });
    await prisma.productTranslation.upsert({ where: { productId_locale: { productId: product.id, locale: "en" } }, update: {}, create: { organizationId: qr.organizationId, productId: product.id, locale: "en", name: longProductNameEnglish, description: "Manually authored local acceptance fixture; no translation provider" } });
    const groups = await prisma.productNoteGroupAssignment.findMany({ where: { productId: product.id }, include: { noteGroup: { include: { options: true } } } });
    for (const { noteGroup } of groups) {
      await prisma.productNoteGroupTranslation.upsert({ where: { noteGroupId_locale: { noteGroupId: noteGroup.id, locale: "en" } }, update: {}, create: { organizationId: qr.organizationId, noteGroupId: noteGroup.id, locale: "en", name: noteGroup.isRequired ? "Required side" : "Optional side" } });
      for (const option of noteGroup.options) await prisma.productNoteOptionTranslation.upsert({ where: { noteOptionId_locale: { noteOptionId: option.id, locale: "en" } }, update: {}, create: { organizationId: qr.organizationId, noteOptionId: option.id, locale: "en", name: noteGroup.isRequired ? "Required test topping" : "Optional test topping" } });
    }
    // Locale completeness applies to the entire menu. Keep prior tasks' products untouched.
    const localeStall = await prisma.stall.upsert({ where: { slug: "b3-fixed-locale" }, update: {}, create: {
      organizationId: qr.organizationId, slug: "b3-fixed-locale", code: "B3-LOCALE",
      name: "B3 local bilingual menu", address: "Synthetic local fixture", location: "Local QA",
      orderingSettings: { create: { organizationId: qr.organizationId, enabledLocales: ["zh-TW", "en"] } },
      stallProducts: { create: { organizationId: qr.organizationId, productId: product.id, isEnabled: true, stockRemaining: null } },
    } });
    let localeQr = await prisma.qrCode.findFirst({ where: { stallId: localeStall.id, label: fixedDataset } });
    if (!localeQr) localeQr = await prisma.qrCode.create({ data: { organizationId: qr.organizationId, stallId: localeStall.id, label: fixedDataset, token: generateResponsiveQrToken() } });
    let importProduct = await prisma.product.findFirst({ where: { organizationId: qr.organizationId, name: "B3 partial import fixture" } });
    if (!importProduct) importProduct = await prisma.product.create({ data: { organizationId: qr.organizationId, categoryId: category.id, name: "B3 partial import fixture", description: "", defaultPrice: 50, isActive: false } });
    const keys = Array.from({ length: 120 }, (_, index) => orderKey(index));
    if (await prisma.order.count({ where: { idempotencyKey: { in: keys } } }) < 120) {
      await prisma.stallProduct.updateMany({ where: { productId: product.id, stallId: qr.stallId }, data: { stockRemaining: null } });
    }
    const createdAt = (await prisma.order.findFirst({ where: { idempotencyKey: keys[0] } }))?.createdAt ?? new Date();
    for (let index = 0; index < 120; index += 1) {
      const key = keys[index];
      if (await prisma.order.findFirst({ where: { idempotencyKey: key } })) continue;
      const order = await prisma.order.create({ data: {
        organizationId: qr.organizationId, stallId: qr.stallId,
        orderNo: `B3-${String(index + 1).padStart(3, "0")}`,
        idempotencyKey: key, trackingTokenHash: hash(`${key}:unissued`), deviceHash: hash(`${key}:device`),
        source: "QR_MENU", isTest: true, customerName: `本機固定測試 ${index + 1}`,
        fulfillmentType: "TAKEOUT", status: "WAITING_CONFIRMATION", paymentStatus: "UNPAID",
        subtotal: 130, total: 130, note: longNote, createdAt, confirmationExpiresAt: new Date(createdAt.getTime() + 600_000),
        items: { create: {
          organizationId: qr.organizationId, stallId: qr.stallId, productId: product.id,
          name: longProductName, baseUnitPrice: 65, unitPrice: 65, quantity: 2, note: longNote, createdAt,
        } },
      } });
      await prisma.order.update({ where: { id: order.id }, data: { status: "CONFIRMED", confirmedAt: createdAt } });
    }
    const orders = await prisma.order.findMany({ where: { idempotencyKey: { in: keys } },
      select: { id: true, orderNo: true, status: true, createdAt: true, total: true, updatedAt: true }, orderBy: { orderNo: "asc" } });
    if (orders.length !== 120) throw new Error("B3_FIXED_DATASET_COUNT_DRIFT");
    const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId: qr.stallId }, select: {
      kdsModuleEnabled: true, printModuleEnabled: true, paymentModuleEnabled: true, enabledLocales: true,
      kdsWarningMinutes: true, kdsCriticalMinutes: true, kdsDefaultView: true,
    } });
    const flags = await prisma.resilienceFeatureFlagOverride.findMany({ select: {
      id: true, flag: { select: { code: true } }, scopeType: true, organizationId: true, stallId: true,
      enabled: true, rolloutPercentage: true, expiresAt: true,
    } });
    mkdirSync(acceptanceDirectory, { recursive: true });
    writeFileSync(`${acceptanceDirectory}/fixed-dataset.json`, JSON.stringify({
      dataset: fixedDataset, capturedAt: new Date().toISOString(), count: orders.length,
      organizationId: qr.organizationId, stallId: qr.stallId, productId: product.id, qrId: qr.id, localeStallId: localeStall.id, localeQrId: localeQr.id, importProductId: importProduct.id,
      fixedCreatedAt: createdAt, orders, orderDigest: hash(JSON.stringify(orders)), settings, flags,
      boundary: "Synthetic local DB fixture; no issued customer tracking token, payment or provider operation",
    }, null, 2));
    return { qrToken: qr.token, localeQrToken: localeQr.token, importProductId: importProduct.id, productId: product.id, stallId: qr.stallId, organizationId: qr.organizationId, orders };
  } finally { await prisma.$disconnect(); }
}
