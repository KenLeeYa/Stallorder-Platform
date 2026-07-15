import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("執行示範資料種子前必須明確設定 ALLOW_DEMO_SEED=true。");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("執行示範資料種子需要 DATABASE_URL。");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("示範資料種子僅允許寫入本機資料庫。");
  }

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
    update: {
      organizationId: organization.id,
      dineInEnabled: true,
      printModuleEnabled: true,
      paymentModuleEnabled: true,
      discountModuleEnabled: true,
    },
    create: {
      stallId: stall.id,
      organizationId: organization.id,
      dineInEnabled: true,
      printModuleEnabled: true,
      paymentModuleEnabled: true,
      discountModuleEnabled: true,
    },
  });
  const diningTable = await prisma.diningTable.upsert({
    where: { stallId_code: { stallId: stall.id, code: "A1" } },
    update: { organizationId: organization.id, label: "A1 桌", isActive: true, sortOrder: 1 },
    create: {
      organizationId: organization.id,
      stallId: stall.id,
      code: "A1",
      label: "A1 桌",
      sortOrder: 1,
    },
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
  await prisma.qrCode.upsert({
    where: { token: "demo-aming-chicken-table-a1-qr-2026" },
    update: {
      organizationId: organization.id,
      stallId: stall.id,
      diningTableId: diningTable.id,
      label: "A1 桌點餐 QR",
      state: "ACTIVE",
    },
    create: {
      organizationId: organization.id,
      stallId: stall.id,
      diningTableId: diningTable.id,
      token: "demo-aming-chicken-table-a1-qr-2026",
      label: "A1 桌點餐 QR",
    },
  });

  const paymentOptions = [
    { code: "CASH", name: "現金", kind: "CASH" as const, sortOrder: 1 },
    { code: "LINE_PAY", name: "LINE Pay", kind: "LINE_PAY" as const, sortOrder: 2 },
    { code: "JKO_PAY", name: "街口支付", kind: "JKO_PAY" as const, sortOrder: 3 },
  ];
  for (const option of paymentOptions) {
    await prisma.paymentOption.upsert({
      where: { stallId_code: { stallId: stall.id, code: option.code } },
      update: { organizationId: organization.id, ...option, isEnabled: true },
      create: { organizationId: organization.id, stallId: stall.id, ...option },
    });
  }
  for (const [index, discount] of [{ name: "9 折", rateBps: 9000 }, { name: "8 折", rateBps: 8000 }].entries()) {
    const existingDiscount = await prisma.discountOption.findFirst({
      where: { stallId: stall.id, organizationId: organization.id, name: discount.name },
    });
    if (existingDiscount) {
      await prisma.discountOption.update({
        where: { id: existingDiscount.id },
        data: { rateBps: discount.rateBps, isEnabled: true, sortOrder: index + 1 },
      });
    } else {
      await prisma.discountOption.create({
        data: { organizationId: organization.id, stallId: stall.id, ...discount, sortOrder: index + 1 },
      });
    }
  }

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
  const seededProducts = new Map<string, string>();
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
    seededProducts.set(name, product.id);
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
    const translations = demoProductTranslations[name];
    for (const translation of translations) {
      await prisma.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale: translation.locale } },
        update: { organizationId: organization.id, name: translation.name, description: translation.description },
        create: { organizationId: organization.id, productId: product.id, ...translation },
      });
    }
  }

  const noteGroupDefinitions = [
    {
      name: "辣度",
      selectionMode: "SINGLE" as const,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 1,
      productNames: ["台式鹽酥雞"],
      translations: [
        { locale: "en", name: "Spice Level" },
        { locale: "ja", name: "辛さ" },
        { locale: "ko", name: "맵기" },
        { locale: "vi", name: "Mức độ cay" },
        { locale: "th", name: "ระดับความเผ็ด" },
      ],
      options: [
        {
          name: "不辣",
          priceDelta: 0,
          translations: [
            { locale: "en", name: "No Spice" },
            { locale: "ja", name: "無辛" },
            { locale: "ko", name: "안 맵게" },
            { locale: "vi", name: "Không cay" },
            { locale: "th", name: "ไม่เผ็ด" },
          ],
        },
        {
          name: "小辣",
          priceDelta: 0,
          translations: [
            { locale: "en", name: "Mild" },
            { locale: "ja", name: "小辛" },
            { locale: "ko", name: "약간 매운맛" },
            { locale: "vi", name: "Ít cay" },
            { locale: "th", name: "เผ็ดน้อย" },
          ],
        },
        {
          name: "中辣",
          priceDelta: 0,
          translations: [
            { locale: "en", name: "Medium" },
            { locale: "ja", name: "中辛" },
            { locale: "ko", name: "보통 매운맛" },
            { locale: "vi", name: "Cay vừa" },
            { locale: "th", name: "เผ็ดปานกลาง" },
          ],
        },
        {
          name: "大辣",
          priceDelta: 0,
          translations: [
            { locale: "en", name: "Hot" },
            { locale: "ja", name: "大辛" },
            { locale: "ko", name: "매운맛" },
            { locale: "vi", name: "Rất cay" },
            { locale: "th", name: "เผ็ดมาก" },
          ],
        },
      ],
    },
    {
      name: "加料",
      selectionMode: "MULTIPLE" as const,
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
      sortOrder: 2,
      productNames: ["香酥雞排", "地瓜薯條", "台式鹽酥雞"],
      translations: [
        { locale: "en", name: "Add-ons" },
        { locale: "ja", name: "追加トッピング" },
        { locale: "ko", name: "추가 토핑" },
        { locale: "vi", name: "Món thêm" },
        { locale: "th", name: "ท็อปปิ้งเพิ่มเติม" },
      ],
      options: [
        {
          name: "加蛋",
          priceDelta: 15,
          translations: [
            { locale: "en", name: "Extra Egg" },
            { locale: "ja", name: "卵追加" },
            { locale: "ko", name: "계란 추가" },
            { locale: "vi", name: "Thêm trứng" },
            { locale: "th", name: "เพิ่มไข่" },
          ],
        },
        {
          name: "加起司",
          priceDelta: 20,
          translations: [
            { locale: "en", name: "Extra Cheese" },
            { locale: "ja", name: "チーズ追加" },
            { locale: "ko", name: "치즈 추가" },
            { locale: "vi", name: "Thêm phô mai" },
            { locale: "th", name: "เพิ่มชีส" },
          ],
        },
        {
          name: "加九層塔",
          priceDelta: 5,
          translations: [
            { locale: "en", name: "Extra Taiwanese Basil" },
            { locale: "ja", name: "台湾バジル追加" },
            { locale: "ko", name: "대만 바질 추가" },
            { locale: "vi", name: "Thêm húng quế Đài Loan" },
            { locale: "th", name: "เพิ่มโหระพาไต้หวัน" },
          ],
        },
      ],
    },
  ];
  for (const definition of noteGroupDefinitions) {
    const noteGroup = await prisma.productNoteGroup.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: definition.name } },
      update: {
        selectionMode: definition.selectionMode,
        isRequired: definition.isRequired,
        minSelections: definition.minSelections,
        maxSelections: definition.maxSelections,
        sortOrder: definition.sortOrder,
        isActive: true,
      },
      create: {
        organizationId: organization.id,
        name: definition.name,
        selectionMode: definition.selectionMode,
        isRequired: definition.isRequired,
        minSelections: definition.minSelections,
        maxSelections: definition.maxSelections,
        sortOrder: definition.sortOrder,
      },
    });
    for (const translation of definition.translations) {
      await prisma.productNoteGroupTranslation.upsert({
        where: { noteGroupId_locale: { noteGroupId: noteGroup.id, locale: translation.locale } },
        update: { organizationId: organization.id, name: translation.name },
        create: { organizationId: organization.id, noteGroupId: noteGroup.id, ...translation },
      });
    }
    for (const [optionIndex, optionDefinition] of definition.options.entries()) {
      const noteOption = await prisma.productNoteOption.upsert({
        where: { noteGroupId_name: { noteGroupId: noteGroup.id, name: optionDefinition.name } },
        update: { organizationId: organization.id, priceDelta: optionDefinition.priceDelta, sortOrder: optionIndex + 1, isActive: true },
        create: { organizationId: organization.id, noteGroupId: noteGroup.id, name: optionDefinition.name, priceDelta: optionDefinition.priceDelta, sortOrder: optionIndex + 1 },
      });
      for (const translation of optionDefinition.translations) {
        await prisma.productNoteOptionTranslation.upsert({
          where: { noteOptionId_locale: { noteOptionId: noteOption.id, locale: translation.locale } },
          update: { organizationId: organization.id, name: translation.name },
          create: { organizationId: organization.id, noteOptionId: noteOption.id, ...translation },
        });
      }
    }
    for (const [assignmentIndex, productName] of definition.productNames.entries()) {
      const productId = seededProducts.get(productName);
      if (!productId) throw new Error(`找不到註記群組商品：${productName}`);
      await prisma.productNoteGroupAssignment.upsert({
        where: { productId_noteGroupId: { productId, noteGroupId: noteGroup.id } },
        update: { organizationId: organization.id, sortOrder: assignmentIndex + 1, isActive: true },
        create: { organizationId: organization.id, productId, noteGroupId: noteGroup.id, sortOrder: assignmentIndex + 1 },
      });
    }
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
        update: { allStalls: true, isActive: true, isPrimaryOwner: true },
        create: {
          organizationId: organization.id,
          profileId: profile.id,
          role: account.role,
          allStalls: true,
          isPrimaryOwner: true,
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

const demoProductTranslations = {
  "香酥雞排": [
    { locale: "en", name: "Deep-Fried Chicken Cutlet", description: "Freshly deep-fried Taiwanese chicken cutlet seasoned with pepper salt." },
    { locale: "ja", name: "鶏肉の揚げ物", description: "揚げたての台湾風大判チキンに胡椒塩をかけました。" },
    { locale: "ko", name: "지파이 (대만식 닭튀김)", description: "갓 튀긴 대만식 대형 닭튀김에 후추 소금을 뿌렸습니다." },
    { locale: "vi", name: "Gà phi lê chiên giòn kiểu Đài Loan", description: "Gà phi lê kiểu Đài Loan chiên nóng, nêm muối tiêu." },
    { locale: "th", name: "ไก่ทอดแผ่นใหญ่สไตล์ไต้หวัน", description: "ไก่ทอดแผ่นใหญ่แบบไต้หวัน โรยเกลือพริกไทย" },
  ],
  "地瓜薯條": [
    { locale: "en", name: "Sweet Potato Fries", description: "Golden, crispy sweet potato fries for sharing." },
    { locale: "ja", name: "さつまいもフライ", description: "黄金色でサクサクのさつまいもフライ。" },
    { locale: "ko", name: "고구마튀김", description: "함께 즐기기 좋은 바삭한 고구마튀김입니다." },
    { locale: "vi", name: "Khoai lang chiên", description: "Khoai lang chiên vàng giòn, thích hợp để dùng chung." },
    { locale: "th", name: "มันหวานทอด", description: "มันหวานทอดกรอบสีทอง เหมาะสำหรับแบ่งกันทาน" },
  ],
  "台式鹽酥雞": [
    { locale: "en", name: "Pepper Popcorn Chicken", description: "Bite-sized fried chicken seasoned with pepper salt and Taiwanese basil." },
    { locale: "ja", name: "台湾風鶏の唐揚げ", description: "一口サイズの鶏の唐揚げを胡椒塩と台湾バジルで仕上げました。" },
    { locale: "ko", name: "셴수지 (타이완식 후라이드 치킨)", description: "한입 크기 닭튀김에 후추 소금과 대만 바질을 곁들였습니다." },
    { locale: "vi", name: "Gà chiên muối tiêu kiểu Đài Loan", description: "Gà chiên miếng nhỏ nêm muối tiêu và húng quế Đài Loan." },
    { locale: "th", name: "ไก่ป๊อปคอร์นพริกไทยสไตล์ไต้หวัน", description: "ไก่ทอดชิ้นพอดีคำปรุงเกลือพริกไทยและโหระพาไต้หวัน" },
  ],
  "冬瓜茶": [
    { locale: "en", name: "Winter Melon Tea", description: "Chilled traditional winter melon tea." },
    { locale: "ja", name: "冬瓜茶", description: "冷たい昔ながらの冬瓜茶。" },
    { locale: "ko", name: "동과차", description: "시원한 전통 동과차입니다." },
    { locale: "vi", name: "Trà bí đao", description: "Trà bí đao truyền thống dùng lạnh." },
    { locale: "th", name: "ชาฟักเขียว", description: "ชาฟักเขียวแบบดั้งเดิมเสิร์ฟเย็น" },
  ],
} as const;

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
