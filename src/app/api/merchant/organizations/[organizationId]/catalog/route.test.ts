import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  getOrganizationCatalog: vi.fn(),
  invalidatePublicMenus: vi.fn(),
  assertSubscriptionUsable: vi.fn(),
  assertLimitAvailable: vi.fn(),
  runTransaction: vi.fn(),
  findChoiceGroup: vi.fn(),
  aggregateChoiceGroups: vi.fn(),
  createChoiceGroup: vi.fn(),
  updateChoiceGroup: vi.fn(),
  findCategory: vi.fn(),
  findProduct: vi.fn(),
  updateProduct: vi.fn(),
  updateProducts: vi.fn(),
  updateStallProducts: vi.fn(),
  findOrderingSettings: vi.fn(),
  updateOrderingSettings: vi.fn(),
  deleteProductTranslations: vi.fn(),
  createChoice: vi.fn(),
  findProducts: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/catalog-data", () => ({ getOrganizationCatalog: mocks.getOrganizationCatalog }));
vi.mock("@/lib/public-menu", () => ({ invalidatePublicMenus: mocks.invalidatePublicMenus }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: vi.fn(() => null),
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: {
    assertSubscriptionUsable: mocks.assertSubscriptionUsable,
    assertLimitAvailable: mocks.assertLimitAvailable,
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findFirst: mocks.findProduct },
    productBundleChoiceGroup: { findFirst: mocks.findChoiceGroup },
    $transaction: mocks.runTransaction,
  },
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const choiceGroupId = "ab100000-0000-4000-8000-000000000001";
const componentProductId = "44444444-4444-4444-8444-444444444441";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: {
      operatingMode: "MULTI_STALL",
      stalls: [{ id: "22222222-2222-4222-8222-222222222222", isActive: true }],
    },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.getOrganizationCatalog.mockResolvedValue({ categories: [], groups: [], products: [] });
  mocks.findChoiceGroup.mockResolvedValue({ id: choiceGroupId, bundleProduct: { kind: "BUNDLE" } });
  mocks.aggregateChoiceGroups.mockResolvedValue({ _sum: { maxSelections: 0 } });
  mocks.createChoiceGroup.mockResolvedValue({ id: choiceGroupId });
  mocks.updateChoiceGroup.mockResolvedValue({ id: choiceGroupId });
  mocks.findCategory.mockResolvedValue({ id: "77777777-7777-4777-8777-777777777771" });
  mocks.findProduct.mockResolvedValue({ id: componentProductId, kind: "SINGLE" });
  mocks.updateProduct.mockResolvedValue({ id: componentProductId });
  mocks.updateProducts.mockResolvedValue({ count: 1 });
  mocks.updateStallProducts.mockResolvedValue({ count: 1 });
  mocks.findOrderingSettings.mockResolvedValue([]);
  mocks.updateOrderingSettings.mockResolvedValue({ stallId: "22222222-2222-4222-8222-222222222222" });
  mocks.deleteProductTranslations.mockResolvedValue({ count: 0 });
  mocks.createChoice.mockResolvedValue({ id: "ab200000-0000-4000-8000-000000000001" });
  mocks.findProducts.mockResolvedValue([]);
  mocks.executeRaw.mockResolvedValue(0);
  mocks.runTransaction.mockImplementation(async (operation) => operation({
    productBundleChoiceGroup: {
      findFirst: mocks.findChoiceGroup,
      aggregate: mocks.aggregateChoiceGroups,
      create: mocks.createChoiceGroup,
      update: mocks.updateChoiceGroup,
    },
    productCategory: { findFirst: mocks.findCategory },
    product: {
      findFirst: mocks.findProduct,
      findMany: mocks.findProducts,
      update: mocks.updateProduct,
      updateMany: mocks.updateProducts,
    },
    stallProduct: { updateMany: mocks.updateStallProducts },
    stallOrderingSettings: {
      findMany: mocks.findOrderingSettings,
      update: mocks.updateOrderingSettings,
    },
    productTranslation: {
      deleteMany: mocks.deleteProductTranslations,
      upsert: vi.fn(),
    },
    productBundleChoice: { create: mocks.createChoice },
    $executeRaw: mocks.executeRaw,
  }));
});

describe("共享商品套餐 API", () => {
  it("以已授權 workspace 的組織建立一般商品選項並留下稽核", async () => {
    const route = await import("./route");
    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "CREATE_BUNDLE_CHOICE",
        choiceGroupId,
        componentProductId,
        quantity: 2,
        priceDelta: 20,
        isEnabled: true,
        sortOrder: 1,
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.createChoice).toHaveBeenCalledWith({
      data: {
        organizationId,
        choiceGroupId,
        componentProductId,
        quantity: 2,
        priceDelta: 20,
        isEnabled: true,
        sortOrder: 1,
      },
      select: { id: true },
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      action: "PRODUCT_BUNDLE_CHOICE_CREATED",
      entityType: "PRODUCT_BUNDLE_CHOICE",
      outcome: "SUCCESS",
    }));
    expect(mocks.invalidatePublicMenus).toHaveBeenCalledWith(["22222222-2222-4222-8222-222222222222"]);
  });

  it("拒絕客戶端注入 organizationId", async () => {
    const route = await import("./route");
    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "CREATE_BUNDLE_CHOICE",
        organizationId: "ab900000-0000-4000-8000-000000000001",
        choiceGroupId,
        componentProductId,
        quantity: 1,
        priceDelta: 0,
        isEnabled: true,
        sortOrder: 1,
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("拒絕把另一個套餐當成選項", async () => {
    mocks.findProduct.mockResolvedValue({ id: componentProductId, kind: "BUNDLE" });
    const route = await import("./route");
    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "CREATE_BUNDLE_CHOICE",
        choiceGroupId,
        componentProductId,
        quantity: 1,
        priceDelta: 0,
        isEnabled: true,
        sortOrder: 1,
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "套餐選項只能使用同一組織的一般商品，不能巢狀加入另一個套餐。",
    });
    expect(mocks.createChoice).not.toHaveBeenCalled();
  });

  it("拒絕建立會讓套餐選項總上限超過公開下單上限的群組", async () => {
    mocks.findProduct.mockResolvedValue({
      id: componentProductId,
      kind: "BUNDLE",
    });
    mocks.aggregateChoiceGroups.mockResolvedValue({ _sum: { maxSelections: 40 } });
    const route = await import("./route");
    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "CREATE_BUNDLE_CHOICE_GROUP",
        bundleProductId: componentProductId,
        name: "加點配菜",
        minSelections: 0,
        maxSelections: 20,
        sortOrder: 1,
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "每個套餐最多可設定 50 個選項上限，請降低群組的最多選擇數。",
      fieldErrors: {
        maxSelections: "每個套餐最多可設定 50 個選項上限，請降低群組的最多選擇數。",
      },
    });
    expect(mocks.createChoiceGroup).not.toHaveBeenCalled();
  });

  it("更新群組時排除自己後仍限制套餐選項總上限", async () => {
    mocks.findChoiceGroup.mockResolvedValue({
      id: choiceGroupId,
      bundleProductId: componentProductId,
    });
    mocks.aggregateChoiceGroups.mockResolvedValue({ _sum: { maxSelections: 35 } });
    const route = await import("./route");
    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "UPDATE_BUNDLE_CHOICE_GROUP",
        choiceGroupId,
        name: "加點配菜",
        minSelections: 0,
        maxSelections: 20,
        sortOrder: 1,
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(409);
    expect(mocks.aggregateChoiceGroups).toHaveBeenCalledWith({
      where: {
        organizationId,
        bundleProductId: componentProductId,
        id: { not: choiceGroupId },
      },
      _sum: { maxSelections: true },
    });
    expect(mocks.updateChoiceGroup).not.toHaveBeenCalled();
  });

  it("以兩次 bulk SQL 同步商品與各攤位公開排序", async () => {
    const firstProductId = "ab300000-0000-4000-8000-000000000001";
    const secondProductId = "ab300000-0000-4000-8000-000000000002";
    const categoryId = "ab400000-0000-4000-8000-000000000001";
    mocks.findProducts.mockResolvedValue([{ id: firstProductId }, { id: secondProductId }]);
    mocks.executeRaw.mockResolvedValueOnce(2).mockResolvedValueOnce(4);
    const route = await import("./route");

    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "REORDER_PRODUCTS",
        categoryId,
        groupId: null,
        productIds: [secondProductId, firstProductId],
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlText(mocks.executeRaw.mock.calls[0]?.[0])).toContain("update public.products");
    expect(sqlText(mocks.executeRaw.mock.calls[1]?.[0])).toContain("update public.stall_products");
    expect(mocks.invalidatePublicMenus).toHaveBeenCalledWith(["22222222-2222-4222-8222-222222222222"]);
  });

  it("將舊停用商品轉為可顯示的售完商品，並同步所有攤位售完狀態", async () => {
    const categoryId = "77777777-7777-4777-8777-777777777771";
    mocks.findProduct
      .mockResolvedValueOnce({
        categoryId,
        groupId: null,
        name: "舊停用商品",
        description: "",
        defaultPrice: 100,
        kind: "SINGLE",
        imageUrl: null,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
        sortOrder: 1,
        isActive: false,
        stallProducts: [{
          stallId: "22222222-2222-4222-8222-222222222222",
          isEnabled: false,
          isSoldOut: false,
        }],
      })
      .mockResolvedValueOnce({
        id: componentProductId,
        categoryId,
        groupId: null,
        kind: "SINGLE",
        imageUrl: null,
        isActive: false,
        sortOrder: 1,
        _count: { bundleChoiceGroups: 0, componentChoices: 0 },
      });
    const route = await import("./route");

    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "UPDATE_PRODUCT",
        productId: componentProductId,
        categoryId,
        groupId: null,
        name: "舊停用商品",
        description: "",
        defaultPrice: 100,
        kind: "SINGLE",
        imageUrl: null,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
        sortOrder: 1,
        isSoldOut: true,
        translations: [],
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.updateProduct).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: componentProductId },
      data: expect.objectContaining({ isActive: true }),
    }));
    expect(mocks.updateStallProducts).toHaveBeenCalledWith({
      where: { organizationId, productId: componentProductId },
      data: { isSoldOut: true, sortOrder: 1, isEnabled: true },
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "PRODUCT_UPDATED",
      after: expect.objectContaining({ isSoldOut: true }),
    }));
  });

  it("在共享商品編輯交易內依攤位儲存結帳推薦", async () => {
    const categoryId = "77777777-7777-4777-8777-777777777771";
    const stallId = "22222222-2222-4222-8222-222222222222";
    mocks.findProduct
      .mockResolvedValueOnce({
        categoryId,
        groupId: null,
        name: "香酥雞排",
        description: "",
        defaultPrice: 95,
        kind: "SINGLE",
        imageUrl: null,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
        sortOrder: 1,
        isActive: true,
        stallProducts: [{ stallId, isEnabled: true, isSoldOut: false }],
      })
      .mockResolvedValueOnce({
        id: componentProductId,
        categoryId,
        groupId: null,
        kind: "SINGLE",
        imageUrl: null,
        isActive: true,
        sortOrder: 1,
        stallProducts: [{ stallId, isEnabled: true, isSoldOut: false }],
        _count: { bundleChoiceGroups: 0, componentChoices: 0 },
      });
    mocks.findOrderingSettings.mockResolvedValue([{ stallId, checkoutUpsellProductIds: [] }]);
    const route = await import("./route");

    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "UPDATE_PRODUCT",
        productId: componentProductId,
        categoryId,
        groupId: null,
        name: "香酥雞排",
        description: "",
        defaultPrice: 95,
        kind: "SINGLE",
        imageUrl: null,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
        sortOrder: 1,
        isSoldOut: false,
        checkoutUpsellStallIds: [stallId],
        translations: [],
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.updateOrderingSettings).toHaveBeenCalledWith({
      where: { stallId },
      data: { checkoutUpsellProductIds: [componentProductId] },
      select: { stallId: true },
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      after: expect.objectContaining({ checkoutUpsellStallIds: [stallId] }),
    }));
  });

  it("商品由排序 2 改為 1 時，自動將同群組後續商品往後移", async () => {
    const categoryId = "77777777-7777-4777-8777-777777777771";
    mocks.findProduct
      .mockResolvedValueOnce({
        categoryId,
        groupId: null,
        name: "第二項",
        description: "",
        defaultPrice: 100,
        kind: "SINGLE",
        imageUrl: null,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
        sortOrder: 2,
        isActive: true,
        stallProducts: [],
      })
      .mockResolvedValueOnce({
        id: componentProductId,
        categoryId,
        groupId: null,
        kind: "SINGLE",
        imageUrl: null,
        isActive: true,
        sortOrder: 2,
        _count: { bundleChoiceGroups: 0, componentChoices: 0 },
      });
    const route = await import("./route");

    const response = await route.POST(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog`, {
      method: "POST",
      body: JSON.stringify({
        operation: "UPDATE_PRODUCT",
        productId: componentProductId,
        categoryId,
        groupId: null,
        name: "第二項",
        description: "",
        defaultPrice: 100,
        kind: "SINGLE",
        imageUrl: null,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
        sortOrder: 1,
        isSoldOut: false,
        translations: [],
      }),
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.updateProducts).toHaveBeenCalledWith({
      where: {
        organizationId,
        categoryId,
        groupId: null,
        id: { not: componentProductId },
        sortOrder: { gte: 1, lt: 2 },
      },
      data: { sortOrder: { increment: 1 } },
    });
    expect(mocks.updateStallProducts).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sortOrder: 1 }),
    }));
  });
});

function sqlText(query: unknown) {
  if (!query || typeof query !== "object" || !("strings" in query)) return "";
  return Array.from((query as { strings: readonly string[] }).strings).join("?");
}
