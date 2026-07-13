import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("禁止在正式環境執行示範資料種子。");

  const organization = await prisma.organization.upsert({
    where: { email: "owner@stallorder.test" },
    update: {
      name: "StallOrder 示範商戶",
      businessName: "StallOrder 示範商戶",
      phone: "0900-000-001",
      status: "ACTIVE",
    },
    create: {
      name: "StallOrder 示範商戶",
      businessName: "StallOrder 示範商戶",
      slug: "stallorder-demo",
      status: "ACTIVE",
      email: "owner@stallorder.test",
      phone: "0900-000-001",
    },
  });

  const stall = await prisma.stall.upsert({
    where: { slug: "aming-chicken" },
    update: {
      organizationId: organization.id,
      name: "阿明鹽酥雞",
      address: "台北市饒河街觀光夜市",
      location: "台北市饒河街觀光夜市",
    },
    create: {
      organizationId: organization.id,
      name: "阿明鹽酥雞",
      slug: "aming-chicken",
      code: "AMING-01",
      address: "台北市饒河街觀光夜市",
      location: "台北市饒河街觀光夜市",
      currency: "TWD",
    },
  });

  await prisma.stallOrderingSettings.upsert({
    where: { stallId: stall.id },
    update: { organizationId: organization.id },
    create: { stallId: stall.id, organizationId: organization.id },
  });
  await prisma.qrCode.upsert({
    where: { token: "demo-aming-chicken-qr-2026-rotate-me" },
    update: { organizationId: organization.id, stallId: stall.id, state: "ACTIVE" },
    create: {
      organizationId: organization.id,
      stallId: stall.id,
      token: "demo-aming-chicken-qr-2026-rotate-me",
      label: "主要點餐 QR v1",
    },
  });

  const products = [
    ["香酥雞排", "現炸雞排，灑上胡椒鹽。", 95, "炸物", "人氣炸物"],
    ["地瓜薯條", "金黃酥脆，適合一起分享。", 55, "炸物", "人氣炸物"],
    ["台式鹽酥雞", "一口大小的鹽酥雞，搭配九層塔。", 75, "炸物", "人氣炸物"],
    ["冬瓜茶", "冰涼古早味冬瓜茶。", 35, "飲料", "清涼飲品"],
  ] as const;
  const categoryIds = new Map<string, string>();
  for (const [index, categoryName] of [...new Set(products.map((product) => product[3]))].entries()) {
    const existingCategory = await prisma.productCategory.findFirst({
      where: { organizationId: organization.id, name: categoryName },
    });
    const category = existingCategory
      ? await prisma.productCategory.update({
        where: { id: existingCategory.id },
        data: { sortOrder: index + 1, isActive: true },
      })
      : await prisma.productCategory.create({
        data: {
        organizationId: organization.id,
        name: categoryName,
        sortOrder: index + 1,
        },
      });
    categoryIds.set(categoryName, category.id);
  }
  const groupIds = new Map<string, string>();
  for (const [index, groupName] of [...new Set(products.map((product) => product[4]))].entries()) {
    const categoryName = products.find((product) => product[4] === groupName)?.[3];
    const categoryId = categoryName ? categoryIds.get(categoryName) : null;
    if (!categoryId) throw new Error(`找不到群組所屬分類：${groupName}`);
    const existingGroup = await prisma.productGroup.findFirst({
      where: { organizationId: organization.id, categoryId, name: groupName },
    });
    const group = existingGroup
      ? await prisma.productGroup.update({
        where: { id: existingGroup.id },
        data: { sortOrder: index + 1, isActive: true },
      })
      : await prisma.productGroup.create({
        data: { organizationId: organization.id, categoryId, name: groupName, sortOrder: index + 1 },
      });
    groupIds.set(groupName, group.id);
  }
  const existing = await prisma.product.findMany({
    where: { organizationId: organization.id },
    orderBy: { sortOrder: "asc" },
  });
  for (const [index, [name, description, defaultPrice, category, group]] of products.entries()) {
    const categoryId = categoryIds.get(category);
    if (!categoryId) throw new Error(`找不到商品分類：${category}`);
    const groupId = groupIds.get(group);
    if (!groupId) throw new Error(`找不到商品群組：${group}`);
    const data = {
      organizationId: organization.id,
      categoryId,
      groupId,
      name,
      description,
      defaultPrice,
      isActive: true,
      sortOrder: index + 1,
    };
    const product = existing[index]
      ? await prisma.product.update({ where: { id: existing[index].id }, data })
      : await prisma.product.create({ data });
    await prisma.stallProduct.upsert({
      where: { stallId_productId: { stallId: stall.id, productId: product.id } },
      update: { organizationId: organization.id, isEnabled: true, isSoldOut: false, sortOrder: index + 1 },
      create: {
        organizationId: organization.id,
        stallId: stall.id,
        productId: product.id,
        sortOrder: index + 1,
      },
    });
  }

  const passwordHash = await hash("StallOrderDemo!2026", 12);
  const accounts = [
    { email: "owner@stallorder.test", displayName: "示範商戶", role: "ORGANIZATION_OWNER" as const },
    { email: "staff@stallorder.test", displayName: "示範店員", role: "STAFF" as const },
    { email: "kitchen@stallorder.test", displayName: "示範廚房", role: "KITCHEN" as const },
  ];
  for (const account of accounts) {
    const profile = await prisma.profile.upsert({
      where: { email: account.email },
      update: { displayName: account.displayName, passwordHash, isActive: true },
      create: { email: account.email, displayName: account.displayName, passwordHash },
    });
    if (account.role === "ORGANIZATION_OWNER") {
      await prisma.organizationMembership.upsert({
        where: {
          organizationId_profileId_role: {
            organizationId: organization.id,
            profileId: profile.id,
            role: account.role,
          },
        },
        update: { allStalls: true, isActive: true },
        create: {
          organizationId: organization.id,
          profileId: profile.id,
          role: account.role,
          allStalls: true,
        },
      });
    } else {
      await prisma.stallMembership.upsert({
        where: {
          stallId_profileId_role: { stallId: stall.id, profileId: profile.id, role: account.role },
        },
        update: { organizationId: organization.id, isActive: true },
        create: {
          organizationId: organization.id,
          profileId: profile.id,
          stallId: stall.id,
          role: account.role,
        },
      });
    }
  }

  const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
  const billingPeriodStart = new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00.000Z");
  const billingPeriodEnd = new Date(billingPeriodStart);
  billingPeriodEnd.setUTCMonth(billingPeriodEnd.getUTCMonth() + 1);
  await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    update: { planId: proPlan.id, status: "ACTIVE", billingPeriodStart, billingPeriodEnd },
    create: {
      organizationId: organization.id,
      planId: proPlan.id,
      status: "ACTIVE",
      billingPeriodStart,
      billingPeriodEnd,
    },
  });
}

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
