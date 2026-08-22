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

  const { billingPeriodStart, billingPeriodEnd, pricingEffectiveAt } = currentTaipeiBillingPeriod();
  const paygPlan = await prisma.plan.findUniqueOrThrow({ where: { code: "PAYG" } });
  const paygPlanVersion = await prisma.planVersion.findFirstOrThrow({
    where: {
      planId: paygPlan.id,
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
    },
    orderBy: { version: "desc" },
  });
  await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    update: {
      planId: paygPlan.id,
      planVersionId: paygPlanVersion.id,
      billingInterval: "MONTHLY",
      status: "ACTIVE",
      billingPeriodStart,
      billingPeriodEnd,
      pricingEffectiveAt,
      trialStartedAt: null,
      trialEndsAt: null,
      paymentDueAt: null,
      pastDueAt: null,
      gracePeriodEndsAt: null,
      suspendedAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
    create: {
      organizationId: organization.id,
      planId: paygPlan.id,
      planVersionId: paygPlanVersion.id,
      billingInterval: "MONTHLY",
      status: "ACTIVE",
      billingPeriodStart,
      billingPeriodEnd,
      pricingEffectiveAt,
    },
  });

  const existingStall = await prisma.stall.findUnique({ where: { slug: "aming-chicken" } });
  const stall = existingStall
    ? await prisma.stall.update({
      where: { id: existingStall.id },
      data: {
        organizationId: organization.id,
        name: "阿明鹽酥雞",
        address: "台北市饒河街觀光夜市",
        location: "台北市饒河街觀光夜市",
      },
    })
    : await prisma.stall.create({
      data: {
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
      deliveryModuleEnabled: true,
      staffDeliveryEnabled: true,
      printModuleEnabled: true,
      kdsModuleEnabled: true,
      paymentModuleEnabled: true,
      discountModuleEnabled: true,
      lotteryEnabled: true,
      discountApprovalThresholdBps: 8000,
      takeoutPreorderEnabled: true,
      preorderSlotMinutes: 5,
      enabledLocales: ["zh-TW", "en", "ja", "ko", "vi", "th"],
    },
    create: {
      stallId: stall.id,
      organizationId: organization.id,
      dineInEnabled: true,
      deliveryModuleEnabled: true,
      staffDeliveryEnabled: true,
      printModuleEnabled: true,
      kdsModuleEnabled: true,
      paymentModuleEnabled: true,
      discountModuleEnabled: true,
      lotteryEnabled: true,
      discountApprovalThresholdBps: 8000,
      takeoutPreorderEnabled: true,
      preorderSlotMinutes: 5,
      enabledLocales: ["zh-TW", "en", "ja", "ko", "vi", "th"],
    },
  });
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    await prisma.stallBusinessHour.upsert({
      where: { stallId_dayOfWeek: { stallId: stall.id, dayOfWeek } },
      update: { organizationId: organization.id, opensAt: "17:00", closesAt: "23:00", isClosed: dayOfWeek === 1 },
      create: { organizationId: organization.id, stallId: stall.id, dayOfWeek, opensAt: "17:00", closesAt: "23:00", isClosed: dayOfWeek === 1 },
    });
  }
  await prisma.printer.upsert({
    where: { stallId_name: { stallId: stall.id, name: "櫃台印表機" } },
    update: { organizationId: organization.id, isEnabled: true },
    create: { organizationId: organization.id, stallId: stall.id, name: "櫃台印表機" },
  });
  const diningTable = await prisma.diningTable.upsert({
    where: { stallId_code: { stallId: stall.id, code: "A1" } },
    update: { organizationId: organization.id, label: "A1 桌", isActive: true, sortOrder: 1, layoutX: 60, layoutY: 80 },
    create: {
      organizationId: organization.id,
      stallId: stall.id,
      code: "A1",
      label: "A1 桌",
      sortOrder: 1,
      layoutX: 60,
      layoutY: 80,
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
  const paymentOptionIds = new Map<string, string>();
  for (const option of paymentOptions) {
    const paymentOption = await prisma.paymentOption.upsert({
      where: { stallId_code: { stallId: stall.id, code: option.code } },
      update: { organizationId: organization.id, ...option, isEnabled: true },
      create: { organizationId: organization.id, stallId: stall.id, ...option },
    });
    paymentOptionIds.set(option.code, paymentOption.id);
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
  const lotteryDiscounts = await prisma.discountOption.findMany({
    where: {
      organizationId: organization.id,
      stallId: stall.id,
      name: { in: ["9 折", "8 折"] },
      isEnabled: true,
    },
    select: { id: true, name: true },
  });
  await prisma.stallLotteryDiscountChance.deleteMany({
    where: {
      stallId: stall.id,
      discountOptionId: { notIn: lotteryDiscounts.map((discount) => discount.id) },
    },
  });
  for (const discount of lotteryDiscounts) {
    const winRateBps = discount.name === "9 折" ? 1_000 : 500;
    await prisma.stallLotteryDiscountChance.upsert({
      where: {
        stallId_discountOptionId: {
          stallId: stall.id,
          discountOptionId: discount.id,
        },
      },
      update: { winRateBps },
      create: { stallId: stall.id, discountOptionId: discount.id, winRateBps },
    });
  }

  const products = [
    ["香酥雞排", "現炸雞排，灑上胡椒鹽。", 95, "炸物", "人氣炸物", "SINGLE"],
    ["地瓜薯條", "金黃酥脆，適合一起分享。", 55, "炸物", "人氣炸物", "SINGLE"],
    ["台式鹽酥雞", "一口大小的鹽酥雞，搭配九層塔。", 75, "炸物", "人氣炸物", "SINGLE"],
    ["甜不辣", "外酥內Q的夜市經典。", 45, "炸物", "經典炸物", "SINGLE"],
    ["米血糕", "酥炸米血糕，口感外脆內軟。", 40, "炸物", "經典炸物", "SINGLE"],
    ["百頁豆腐", "金黃酥香、口感紮實。", 45, "炸物", "經典炸物", "SINGLE"],
    ["雞蛋豆腐", "嫩口雞蛋豆腐炸至金黃。", 55, "炸物", "經典炸物", "SINGLE"],
    ["四季豆", "爽脆四季豆，現點現炸。", 45, "蔬食", "酥炸蔬菜", "SINGLE"],
    ["杏鮑菇", "多汁杏鮑菇，外層酥香。", 55, "蔬食", "酥炸蔬菜", "SINGLE"],
    ["玉米筍", "清甜玉米筍，適合搭配炸物。", 50, "蔬食", "酥炸蔬菜", "SINGLE"],
    ["冬瓜茶", "冰涼古早味冬瓜茶。", 35, "飲料", "古早味飲品", "SINGLE"],
    ["無糖綠茶", "清爽無糖茶香，解膩首選。", 30, "飲料", "茶飲", "SINGLE"],
    ["檸檬紅茶", "檸檬酸香搭配清爽紅茶。", 45, "飲料", "茶飲", "SINGLE"],
    ["梅子可樂", "酸甜梅香氣泡飲。", 50, "飲料", "氣泡飲品", "SINGLE"],
    ["人氣雙享餐", "任選人氣主餐與配餐，套餐更優惠。", 150, "套餐", "超值套餐", "BUNDLE"],
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
  const existingByName = new Map(existing.map((product) => [product.name, product]));
  const seededProducts = new Map<string, string>();
  for (const [index, [name, description, defaultPrice, category, group, kind]] of products.entries()) {
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
      kind,
      isLotteryEligible: kind === "SINGLE",
      isActive: true,
      sortOrder: index + 1,
    };
    const existingProduct = existingByName.get(name);
    const product = existingProduct
      ? await prisma.product.update({ where: { id: existingProduct.id }, data })
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
    const translations = demoProductTranslations[name as keyof typeof demoProductTranslations] ?? [];
    for (const translation of translations) {
      await prisma.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale: translation.locale } },
        update: { organizationId: organization.id, name: translation.name, description: translation.description },
        create: { organizationId: organization.id, productId: product.id, ...translation },
      });
    }
  }

  const bundleProductId = seededProducts.get("人氣雙享餐");
  if (!bundleProductId) throw new Error("找不到示範套餐：人氣雙享餐");
  const bundleGroupDefinitions = [
    { name: "選擇主餐", minSelections: 1, maxSelections: 1, productNames: ["香酥雞排", "台式鹽酥雞"] },
    { name: "選擇配餐", minSelections: 1, maxSelections: 1, productNames: ["地瓜薯條", "甜不辣", "無糖綠茶"] },
  ] as const;
  for (const [groupIndex, definition] of bundleGroupDefinitions.entries()) {
    const choiceGroup = await prisma.productBundleChoiceGroup.upsert({
      where: { bundleProductId_name: { bundleProductId, name: definition.name } },
      update: {
        organizationId: organization.id,
        minSelections: definition.minSelections,
        maxSelections: definition.maxSelections,
        sortOrder: groupIndex + 1,
      },
      create: {
        organizationId: organization.id,
        bundleProductId,
        name: definition.name,
        minSelections: definition.minSelections,
        maxSelections: definition.maxSelections,
        sortOrder: groupIndex + 1,
      },
    });
    for (const [choiceIndex, productName] of definition.productNames.entries()) {
      const componentProductId = seededProducts.get(productName);
      if (!componentProductId) throw new Error(`找不到套餐元件商品：${productName}`);
      await prisma.productBundleChoice.upsert({
        where: { choiceGroupId_componentProductId: { choiceGroupId: choiceGroup.id, componentProductId } },
        update: { organizationId: organization.id, quantity: 1, priceDelta: 0, isEnabled: true, sortOrder: choiceIndex + 1 },
        create: {
          organizationId: organization.id,
          choiceGroupId: choiceGroup.id,
          componentProductId,
          quantity: 1,
          priceDelta: 0,
          sortOrder: choiceIndex + 1,
        },
      });
    }
  }

  const reusableNoteDefinitions = [
    { name: "不加胡椒", priceDelta: 0 },
    { name: "加九層塔", priceDelta: 5 },
    { name: "加蒜", priceDelta: 5 },
    { name: "分開裝", priceDelta: 0 },
    { name: "少冰", priceDelta: 0 },
    { name: "去冰", priceDelta: 0 },
    { name: "半糖", priceDelta: 0 },
    { name: "無糖", priceDelta: 0 },
  ] as const;
  const reusableNoteIds = new Map<string, string>();
  for (const [index, definition] of reusableNoteDefinitions.entries()) {
    const reusableNote = await prisma.reusableProductNote.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: definition.name } },
      update: { priceDelta: definition.priceDelta, sortOrder: index + 1, isActive: true },
      create: { organizationId: organization.id, ...definition, sortOrder: index + 1 },
    });
    reusableNoteIds.set(definition.name, reusableNote.id);
  }

  const noteGroupDefinitions = [
    {
      name: "辣度",
      selectionMode: "SINGLE" as const,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 1,
      productNames: ["台式鹽酥雞", "甜不辣", "米血糕", "百頁豆腐", "雞蛋豆腐", "四季豆", "杏鮑菇", "玉米筍"],
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
      productNames: ["香酥雞排", "地瓜薯條", "台式鹽酥雞", "甜不辣", "米血糕", "百頁豆腐", "雞蛋豆腐", "四季豆", "杏鮑菇", "玉米筍"],
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
    {
      name: "包裝需求",
      selectionMode: "MULTIPLE" as const,
      isRequired: false,
      minSelections: 0,
      maxSelections: 3,
      sortOrder: 3,
      productNames: ["香酥雞排", "地瓜薯條", "台式鹽酥雞", "甜不辣", "米血糕", "百頁豆腐", "雞蛋豆腐", "四季豆", "杏鮑菇", "玉米筍"],
      translations: [],
      options: [
        { name: "不加胡椒", priceDelta: 0, translations: [] },
        { name: "加蒜", priceDelta: 5, translations: [] },
        { name: "分開裝", priceDelta: 0, translations: [] },
      ],
    },
    {
      name: "甜度",
      selectionMode: "SINGLE" as const,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 4,
      productNames: ["冬瓜茶", "檸檬紅茶", "梅子可樂"],
      translations: [],
      options: [
        { name: "半糖", priceDelta: 0, translations: [] },
        { name: "無糖", priceDelta: 0, translations: [] },
      ],
    },
    {
      name: "冰量",
      selectionMode: "SINGLE" as const,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 5,
      productNames: ["冬瓜茶", "無糖綠茶", "檸檬紅茶", "梅子可樂"],
      translations: [],
      options: [
        { name: "少冰", priceDelta: 0, translations: [] },
        { name: "去冰", priceDelta: 0, translations: [] },
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
        update: { organizationId: organization.id, reusableNoteId: reusableNoteIds.get(optionDefinition.name), priceDelta: optionDefinition.priceDelta, sortOrder: optionIndex + 1, isActive: true },
        create: { organizationId: organization.id, noteGroupId: noteGroup.id, reusableNoteId: reusableNoteIds.get(optionDefinition.name), name: optionDefinition.name, priceDelta: optionDefinition.priceDelta, sortOrder: optionIndex + 1 },
      });
      for (const translation of optionDefinition.translations) {
        await prisma.productNoteOptionTranslation.upsert({
          where: { noteOptionId_locale: { noteOptionId: noteOption.id, locale: translation.locale } },
          update: { organizationId: organization.id, name: translation.name },
          create: { organizationId: organization.id, noteOptionId: noteOption.id, ...translation },
        });
      }
    }
    if (definition.name === "包裝需求") {
      await prisma.productNoteOption.updateMany({
        where: { organizationId: organization.id, noteGroupId: noteGroup.id, name: "加九層塔" },
        data: { reusableNoteId: null, isActive: false },
      });
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

  const demoBestSellerSales = [
    { productName: "香酥雞排", quantity: 3 },
    { productName: "香酥雞排", quantity: 3 },
    { productName: "香酥雞排", quantity: 3 },
    { productName: "香酥雞排", quantity: 3 },
    { productName: "地瓜薯條", quantity: 4 },
    { productName: "地瓜薯條", quantity: 2 },
    { productName: "地瓜薯條", quantity: 2 },
    { productName: "台式鹽酥雞", quantity: 1 },
    { productName: "台式鹽酥雞", quantity: 1 },
    { productName: "台式鹽酥雞", quantity: 1 },
  ] as const;
  const cashPaymentOptionId = paymentOptionIds.get("CASH");
  if (!cashPaymentOptionId) throw new Error("找不到示範現金付款方式。");
  const firstDemoOrderId = "b5100000-0000-4000-8000-000000000001";
  const firstDemoOrder = await prisma.order.findUnique({
    where: { id: firstDemoOrderId },
    select: { createdAt: true },
  });
  const firstDemoCompletedAt = firstDemoOrder?.createdAt
    ?? new Date(Date.now() - 60 * 60 * 1_000);
  const demoPaymentDefinitions: Array<{ orderId: string; amount: number; paidAt: Date }> = [];
  for (const [saleIndex, sale] of demoBestSellerSales.entries()) {
    const sequence = String(saleIndex + 1).padStart(12, "0");
    const productId = seededProducts.get(sale.productName);
    if (!productId) throw new Error(`找不到熱銷示範商品：${sale.productName}`);
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { defaultPrice: true },
    });
    const completedAt = new Date(firstDemoCompletedAt.getTime() - saleIndex * 60 * 60 * 1_000);
    const orderId = `b5100000-0000-4000-8000-${sequence}`;
    const subtotal = product.defaultPrice * sale.quantity;
    await prisma.order.upsert({
      where: { id: orderId },
      update: {
        organizationId: organization.id,
        stallId: stall.id,
        source: "DEMO_BESTSELLER_SEED",
        origin: "IMPORTED",
        isTest: false,
        customerName: "熱銷示範訂單",
        fulfillmentType: "TAKEOUT",
        status: "COMPLETED",
        paymentStatus: "PAID",
        subtotal,
        total: subtotal,
        confirmationExpiresAt: completedAt,
        confirmedAt: completedAt,
        paidAt: completedAt,
        completedAt,
        createdAt: completedAt,
        cancelledAt: null,
      },
      create: {
        id: orderId,
        organizationId: organization.id,
        stallId: stall.id,
        orderNo: `DEMO-HOT-${String(saleIndex + 1).padStart(3, "0")}`,
        trackingTokenHash: `${"b".repeat(61)}${String(saleIndex + 1).padStart(3, "0")}`,
        idempotencyKey: `b5300000-0000-4000-8000-${sequence}`,
        source: "DEMO_BESTSELLER_SEED",
        origin: "IMPORTED",
        isTest: false,
        customerName: "熱銷示範訂單",
        fulfillmentType: "TAKEOUT",
        status: "COMPLETED",
        paymentStatus: "PAID",
        subtotal,
        total: subtotal,
        deviceHash: "demo-bestseller-seed".padEnd(64, "0"),
        confirmationExpiresAt: completedAt,
        confirmedAt: completedAt,
        paidAt: completedAt,
        completedAt,
        createdAt: completedAt,
      },
    });
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.orderItem.create({
      data: {
        id: `b5200000-0000-4000-8000-${sequence}`,
        organizationId: organization.id,
        stallId: stall.id,
        orderId,
        productId,
        sourceLineIndex: 1,
        name: sale.productName,
        baseUnitPrice: product.defaultPrice,
        unitPrice: product.defaultPrice,
        quantity: sale.quantity,
        status: "SERVED",
      },
    });
    demoPaymentDefinitions.push({ orderId, amount: subtotal, paidAt: completedAt });
  }

  const passwordHash = await hash("StallOrderDemo!2026", 12);
  const accounts = [
    { email: "owner@stallorder.test", displayName: "示範商戶", role: "ORGANIZATION_OWNER" as const },
    { email: "staff@stallorder.test", displayName: "示範店員", role: "STAFF" as const },
    { email: "kitchen@stallorder.test", displayName: "示範廚房", role: "KITCHEN" as const },
  ];
  const profileIds = new Map<string, string>();
  for (const account of accounts) {
    const profile = await prisma.profile.upsert({
      where: { email: account.email },
      update: { displayName: account.displayName, passwordHash, isActive: true },
      create: { email: account.email, displayName: account.displayName, passwordHash },
    });
    profileIds.set(account.email, profile.id);
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

  const ownerProfileId = profileIds.get("owner@stallorder.test");
  if (!ownerProfileId) throw new Error("找不到示範商戶帳號。");
  const demoCashShiftId = "b5400000-0000-4000-8000-000000000001";
  const demoCashShiftOpenedAt = new Date(
    Math.min(...demoPaymentDefinitions.map((payment) => payment.paidAt.getTime())) - 60_000,
  );
  const demoCashShiftClosedAt = new Date(
    Math.max(...demoPaymentDefinitions.map((payment) => payment.paidAt.getTime())) + 60_000,
  );
  const demoCashTotal = demoPaymentDefinitions.reduce((total, payment) => total + payment.amount, 0);
  await prisma.$transaction(async (transaction) => {
    let demoCashShift = await transaction.cashShift.findUnique({
      where: { id: demoCashShiftId },
    });
    if (!demoCashShift) {
      const activeCashShift = await transaction.cashShift.findFirst({
        where: { stallId: stall.id, status: "OPEN" },
        select: { id: true },
      });
      if (activeCashShift) throw new Error("請先關閉目前現金班次，再執行示範資料種子。");
      demoCashShift = await transaction.cashShift.create({
        data: {
          id: demoCashShiftId,
          organizationId: organization.id,
          stallId: stall.id,
          openingAmount: 0,
          note: "熱銷示範現金班次",
          openedById: ownerProfileId,
          openedAt: demoCashShiftOpenedAt,
          createdAt: demoCashShiftOpenedAt,
        },
      });
    }
    if (demoCashShift.status !== "OPEN" && demoCashShift.status !== "CLOSED") {
      throw new Error("示範現金班次狀態無法安全重跑種子。");
    }
    if (demoCashShift.status === "CLOSED") {
      const existingPaymentCount = await transaction.payment.count({
        where: {
          cashShiftId: demoCashShiftId,
          orderId: { in: demoPaymentDefinitions.map((payment) => payment.orderId) },
        },
      });
      if (existingPaymentCount !== demoPaymentDefinitions.length) {
        throw new Error("示範現金班次已關閉，但付款資料不完整。");
      }
    }
    for (const payment of demoPaymentDefinitions) {
      const paymentData = {
        organizationId: organization.id,
        stallId: stall.id,
        paymentOptionId: cashPaymentOptionId,
        cashShiftId: demoCashShiftId,
        amount: payment.amount,
        method: "CASH" as const,
        status: "PAID" as const,
        reference: "DEMO_BESTSELLER_SEED",
        methodLabel: "現金",
        reconciliationStatus: null,
        cashReceived: payment.amount,
        changeAmount: 0,
        recordedById: ownerProfileId,
        paidAt: payment.paidAt,
        createdAt: payment.paidAt,
      };
      if (demoCashShift.status === "CLOSED") {
        await transaction.payment.update({
          where: { orderId: payment.orderId },
          data: paymentData,
        });
      } else {
        await transaction.payment.upsert({
          where: { orderId: payment.orderId },
          update: paymentData,
          create: { ...paymentData, orderId: payment.orderId },
        });
      }
    }
    if (demoCashShift.status === "OPEN") {
      await transaction.cashShift.update({
        where: { id: demoCashShiftId },
        data: {
          status: "CLOSED",
          systemExpectedAmount: demoCashTotal,
          countedAmount: demoCashTotal,
          varianceAmount: 0,
          closedById: ownerProfileId,
          closedAt: demoCashShiftClosedAt,
        },
      });
    }
  });

  await prisma.profile.upsert({
    where: { email: "platform.admin@stallorder.test" },
    update: {
      displayName: "示範平台管理員",
      passwordHash,
      platformRole: "PLATFORM_ADMIN",
      isActive: true,
    },
    create: {
      email: "platform.admin@stallorder.test",
      displayName: "示範平台管理員",
      passwordHash,
      platformRole: "PLATFORM_ADMIN",
    },
  });

  const legacyOrganization = await prisma.organization.upsert({
    where: { email: "legacy.billing@stallorder.test" },
    update: {
      name: "StallOrder Legacy 計費測試商戶",
      businessName: "StallOrder Legacy 計費測試商戶",
      status: "ACTIVE",
    },
    create: {
      id: "11111111-1111-4111-8111-111111111112",
      name: "StallOrder Legacy 計費測試商戶",
      businessName: "StallOrder Legacy 計費測試商戶",
      slug: "stallorder-legacy-billing-fixture",
      status: "ACTIVE",
      email: "legacy.billing@stallorder.test",
      phone: "0900-000-099",
    },
  });
  const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
  const proPlanVersion = await prisma.planVersion.findFirstOrThrow({
    where: {
      planId: proPlan.id,
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
    },
    orderBy: { version: "desc" },
  });
  await prisma.subscription.upsert({
    where: { organizationId: legacyOrganization.id },
    update: {
      planId: proPlan.id,
      planVersionId: proPlanVersion.id,
      billingInterval: "MONTHLY",
      status: "ACTIVE",
      billingPeriodStart,
      billingPeriodEnd,
      paymentDueAt: billingPeriodEnd,
      pricingEffectiveAt: null,
    },
    create: {
      organizationId: legacyOrganization.id,
      planId: proPlan.id,
      planVersionId: proPlanVersion.id,
      billingInterval: "MONTHLY",
      status: "ACTIVE",
      billingPeriodStart,
      billingPeriodEnd,
      paymentDueAt: billingPeriodEnd,
    },
  });
}

function currentTaipeiBillingPeriod(now = new Date()) {
  const parts = new Map(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const year = Number(parts.get("year"));
  const month = Number(parts.get("month"));
  const billingPeriodStart = new Date(Date.UTC(year, month - 1, 1));
  return {
    billingPeriodStart,
    billingPeriodEnd: new Date(Date.UTC(year, month, 1)),
    pricingEffectiveAt: new Date(billingPeriodStart.getTime() - 8 * 60 * 60 * 1_000),
  };
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
