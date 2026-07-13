import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("禁止在正式環境執行示範資料種子。");

  const merchant = await prisma.merchant.upsert({
    where: { email: "owner@stallorder.test" },
    update: { name: "StallOrder 示範商戶", phone: "0900-000-001", status: "ACTIVE" },
    create: {
      name: "StallOrder 示範商戶",
      slug: "stallorder-demo",
      status: "ACTIVE",
      email: "owner@stallorder.test",
      phone: "0900-000-001",
    },
  });

  const stall = await prisma.stall.upsert({
    where: { slug: "aming-chicken" },
    update: { merchantId: merchant.id, name: "阿明鹽酥雞", location: "台北市饒河街觀光夜市" },
    create: {
      merchantId: merchant.id,
      name: "阿明鹽酥雞",
      slug: "aming-chicken",
      location: "台北市饒河街觀光夜市",
      currency: "TWD",
    },
  });

  await prisma.stallOrderingSettings.upsert({
    where: { stallId: stall.id },
    update: { tenantId: merchant.id },
    create: { stallId: stall.id, tenantId: merchant.id },
  });
  await prisma.qrCode.upsert({
    where: { token: "demo-aming-chicken-qr-2026-rotate-me" },
    update: { tenantId: merchant.id, stallId: stall.id, state: "ACTIVE" },
    create: {
      tenantId: merchant.id,
      stallId: stall.id,
      token: "demo-aming-chicken-qr-2026-rotate-me",
      label: "主要點餐 QR v1",
    },
  });

  const products = [
    ["香酥雞排", "現炸雞排，灑上胡椒鹽。", 95, "炸物"],
    ["地瓜薯條", "金黃酥脆，適合一起分享。", 55, "炸物"],
    ["台式鹽酥雞", "一口大小的鹽酥雞，搭配九層塔。", 75, "炸物"],
    ["冬瓜茶", "冰涼古早味冬瓜茶。", 35, "飲料"],
  ] as const;
  const categoryIds = new Map<string, string>();
  for (const [index, categoryName] of [...new Set(products.map((product) => product[3]))].entries()) {
    const category = await prisma.productCategory.upsert({
      where: { stallId_name: { stallId: stall.id, name: categoryName } },
      update: { tenantId: merchant.id, sortOrder: index + 1, isActive: true },
      create: {
        tenantId: merchant.id,
        stallId: stall.id,
        name: categoryName,
        sortOrder: index + 1,
      },
    });
    categoryIds.set(categoryName, category.id);
  }
  const existing = await prisma.product.findMany({ where: { stallId: stall.id }, orderBy: { sortOrder: "asc" } });
  for (const [index, [name, description, price, category]] of products.entries()) {
    const categoryId = categoryIds.get(category);
    if (!categoryId) throw new Error(`找不到商品分類：${category}`);
    const data = { tenantId: merchant.id, stallId: stall.id, categoryId, name, description, price, sortOrder: index + 1 };
    if (existing[index]) await prisma.product.update({ where: { id: existing[index].id }, data });
    else await prisma.product.create({ data });
  }

  const passwordHash = await hash("StallOrderDemo!2026", 12);
  const accounts = [
    { email: "owner@stallorder.test", displayName: "示範商戶", role: "MERCHANT_OWNER" as const },
    { email: "staff@stallorder.test", displayName: "示範店員", role: "STAFF" as const },
    { email: "kitchen@stallorder.test", displayName: "示範廚房", role: "KITCHEN" as const },
  ];
  for (const account of accounts) {
    const user = await prisma.userAccount.upsert({
      where: { email: account.email },
      update: { displayName: account.displayName, passwordHash, isActive: true },
      create: { email: account.email, displayName: account.displayName, passwordHash },
    });
    await prisma.stallMembership.upsert({
      where: { userId_stallId: { userId: user.id, stallId: stall.id } },
      update: { tenantId: merchant.id, role: account.role, isActive: true },
      create: { tenantId: merchant.id, userId: user.id, stallId: stall.id, role: account.role },
    });
  }
}

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
