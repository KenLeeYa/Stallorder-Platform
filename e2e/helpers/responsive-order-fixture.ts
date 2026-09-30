import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";

export async function createResponsiveOrderFixture(prisma: PrismaClient): Promise<{
  runId: string;
  qrToken: string;
  productId: string;
  stallId: string;
  stallSlug: string;
  organizationId: string;
  baselineTotal: number;
}> {
  assertResponsiveQaTarget(process.env);

  const runId = randomUUID();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { email: "owner@stallorder.test" },
    select: { id: true },
  });
  const stall = await prisma.stall.findUniqueOrThrow({
    where: { slug: "aming-chicken" },
    select: { id: true, slug: true, organizationId: true },
  });
  if (stall.organizationId !== organization.id) {
    throw new Error("RESPONSIVE_QA_DEMO_STALL_MISMATCH");
  }
  const category = await prisma.productCategory.findFirstOrThrow({
    where: { organizationId: organization.id, isActive: true },
    select: { id: true },
  });
  const suffix = runId.slice(0, 8);
  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      categoryId: category.id,
      name: `跨裝置 QA 餐 ${suffix}`,
      description: "隔離本機同單流程測試商品",
      defaultPrice: 50,
      kind: "SINGLE",
      isActive: true,
      stallProducts: {
        create: {
          organizationId: organization.id,
          stallId: stall.id,
          isEnabled: true,
          isSoldOut: false,
          stockRemaining: 100,
        },
      },
    },
    select: { id: true },
  });

  for (const [index, group] of [
    { name: `必選配料 ${suffix}`, isRequired: true, optionName: "QA 必選加料", priceDelta: 10 },
    { name: `可選配料 ${suffix}`, isRequired: false, optionName: "QA 可選加料", priceDelta: 5 },
  ].entries()) {
    const noteGroup = await prisma.productNoteGroup.create({
      data: {
        organizationId: organization.id,
        name: group.name,
        selectionMode: index === 0 ? "SINGLE" : "MULTIPLE",
        isRequired: group.isRequired,
        minSelections: group.isRequired ? 1 : 0,
        maxSelections: 1,
        sortOrder: index,
        options: {
          create: {
            organizationId: organization.id,
            name: group.optionName,
            priceDelta: group.priceDelta,
            sortOrder: 0,
          },
        },
      },
      select: { id: true },
    });
    await prisma.productNoteGroupAssignment.create({
      data: {
        organizationId: organization.id,
        productId: product.id,
        noteGroupId: noteGroup.id,
        sortOrder: index,
      },
    });
  }

  await prisma.stall.update({
    where: { id: stall.id },
    data: { orderingEnabled: true, orderingState: "OPEN", businessStatus: "OPEN", isSoldOut: false },
  });
  await prisma.stallBusinessHour.updateMany({
    where: { stallId: stall.id },
    data: { opensAt: "00:00", closesAt: "00:00", lastOrderAt: null, isClosed: false },
  });
  await prisma.stallOrderingSettings.update({
    where: { stallId: stall.id },
    data: { kdsModuleEnabled: true, printModuleEnabled: false, paymentModuleEnabled: true },
  });
  await prisma.stallCapacitySettings.upsert({
    where: { stallId: stall.id },
    update: { acknowledgmentThresholdMinutes: 1 },
    create: { organizationId: organization.id, stallId: stall.id, acknowledgmentThresholdMinutes: 1 },
  });
  const openShift = await prisma.cashShift.findFirst({
    where: { stallId: stall.id, status: "OPEN" },
    select: { id: true },
  });
  if (!openShift) {
    const staff = await prisma.profile.findUniqueOrThrow({
      where: { email: "staff@stallorder.test" },
      select: { id: true },
    });
    await prisma.cashShift.create({
      data: {
        organizationId: organization.id,
        stallId: stall.id,
        openingAmount: 0,
        openedById: staff.id,
        note: `Responsive QA ${runId}`,
      },
    });
  }
  const qrVersion = await prisma.qrCode.aggregate({
    where: { stallId: stall.id },
    _max: { tokenVersion: true },
  });
  const qrToken = `responsive-qa-${runId}`;
  await prisma.qrCode.create({
    data: {
      organizationId: organization.id,
      stallId: stall.id,
      token: qrToken,
      label: `Responsive QA ${runId}`,
      state: "ACTIVE",
      tokenVersion: (qrVersion._max.tokenVersion ?? 0) + 1,
    },
  });

  return {
    runId,
    qrToken,
    productId: product.id,
    stallId: stall.id,
    stallSlug: stall.slug,
    organizationId: organization.id,
    baselineTotal: 130,
  };
}
