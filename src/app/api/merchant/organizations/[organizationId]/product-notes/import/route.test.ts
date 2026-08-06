import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  findOrganization: vi.fn(),
  findProducts: vi.fn(),
  findReusableNotes: vi.fn(),
  findGroups: vi.fn(),
  transaction: vi.fn(),
  upsertReusableNote: vi.fn(),
  upsertReusableTranslation: vi.fn(),
  upsertGroup: vi.fn(),
  upsertGroupTranslation: vi.fn(),
  upsertAssignment: vi.fn(),
  upsertOption: vi.fn(),
  upsertOptionTranslation: vi.fn(),
  getProductNotes: vi.fn(),
  getReusableProductNotes: vi.fn(),
  invalidatePublicMenus: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/lib/public-menu", () => ({ invalidatePublicMenus: mocks.invalidatePublicMenus }));
vi.mock("@/lib/product-note-data", () => ({
  getOrganizationProductNotes: mocks.getProductNotes,
  getOrganizationReusableProductNotes: mocks.getReusableProductNotes,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: mocks.findOrganization },
    product: { findMany: mocks.findProducts },
    reusableProductNote: { findMany: mocks.findReusableNotes },
    productNoteGroup: { findMany: mocks.findGroups },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: { assertFeatureEnabled: mocks.assertFeatureEnabled },
}));
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: vi.fn(() => null),
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: { stalls: [] },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.assertFeatureEnabled.mockResolvedValue(undefined);
  mocks.findOrganization.mockResolvedValue({ defaultCurrency: "TWD" });
  mocks.findProducts.mockResolvedValue([{ id: productId, name: "招牌河粉" }]);
  mocks.findReusableNotes.mockResolvedValue([]);
  mocks.findGroups.mockResolvedValue([]);
  mocks.upsertReusableNote.mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    name: "不加香菜",
    priceDelta: 10,
    isActive: true,
  });
  mocks.upsertGroup.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" });
  mocks.upsertOption.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
  mocks.transaction.mockImplementation(async (operation) => operation({
    reusableProductNote: { upsert: mocks.upsertReusableNote },
    reusableProductNoteTranslation: { upsert: mocks.upsertReusableTranslation },
    productNoteGroup: { upsert: mocks.upsertGroup },
    productNoteGroupTranslation: { upsert: mocks.upsertGroupTranslation },
    productNoteGroupAssignment: { upsert: mocks.upsertAssignment },
    productNoteOption: { upsert: mocks.upsertOption },
    productNoteOptionTranslation: { upsert: mocks.upsertOptionTranslation },
  }));
  mocks.getProductNotes.mockResolvedValue([]);
  mocks.getReusableProductNotes.mockResolvedValue([]);
  mocks.invalidatePublicMenus.mockResolvedValue(undefined);
});

describe("商品註記匯入 API", () => {
  it.each(["PREVIEW", "APPLY"] as const)("%s 以資料庫幣別 fail closed", async (mode) => {
    const route = await import("./route");
    const response = await route.POST(importRequest({
      schemaVersion: 1,
      exportedAt: "2026-08-05T00:00:00.000Z",
      sourceCurrency: "USD",
      reusableNotes: [],
      groups: [],
    }, mode), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "匯入檔幣別為 USD，目前商家幣別為 TWD；為避免價格調整金額誤用，無法匯入。",
    });
    expect(mocks.findProducts).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("預覽明確標示同名更新及會覆寫的欄位差異", async () => {
    mocks.findReusableNotes.mockResolvedValue([{
      name: "不加香菜",
      priceDelta: 0,
      sortOrder: 1,
      isActive: false,
      translations: [],
    }]);
    mocks.findGroups.mockResolvedValue([{
      name: "客製口味",
      selectionMode: "SINGLE",
      isRequired: false,
      minSelections: 0,
      maxSelections: 1,
      sortOrder: 1,
      isActive: true,
      translations: [],
      assignments: [{
        productId,
        sortOrder: 5,
        isActive: false,
        product: { name: "招牌河粉" },
      }],
      options: [],
    }]);
    const route = await import("./route");
    const response = await route.POST(importRequest(transferFixture(), "PREVIEW"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.summary).toMatchObject({
      reusableNoteCreateCount: 0,
      reusableNoteUpdateCount: 1,
      groupCreateCount: 0,
      groupUpdateCount: 1,
    });
    expect(payload.previewReusableNotes[0]).toMatchObject({
      name: "不加香菜",
      changeType: "UPDATE",
      changes: expect.arrayContaining([
        { field: "價格調整", before: "0 TWD", after: "10 TWD" },
      ]),
    });
    expect(payload.previewGroups[0]).toMatchObject({
      name: "客製口味",
      changeType: "UPDATE",
      changes: expect.arrayContaining([
        { field: "商品指派「招牌河粉」排序", before: "5", after: "37" },
      ]),
    });
  });

  it("預覽回傳 1MB 契約內的全部 500 筆共用註記與 200 筆群組", async () => {
    const transfer = {
      schemaVersion: 1,
      exportedAt: "2026-08-05T00:00:00.000Z",
      sourceCurrency: "TWD",
      reusableNotes: Array.from({ length: 500 }, (_, index) => ({
        name: `共用註記${index}`,
        priceDelta: 0,
        sortOrder: index,
        isActive: true,
        translations: [],
      })),
      groups: Array.from({ length: 200 }, (_, index) => ({
        name: `註記群組${index}`,
        selectionMode: "MULTIPLE",
        isRequired: false,
        minSelections: 0,
        maxSelections: null,
        sortOrder: index,
        isActive: true,
        translations: [],
        products: [],
        options: [],
      })),
    };
    const route = await import("./route");
    const response = await route.POST(importRequest(transfer, "PREVIEW"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.previewReusableNotes).toHaveLength(500);
    expect(payload.previewGroups).toHaveLength(200);
    expect(payload.previewReusableNotes.at(-1)?.name).toBe("共用註記499");
    expect(payload.previewGroups.at(-1)?.name).toBe("註記群組199");
  });

  it("允許匯入啟用中但暫時沒有選項的必選群組現況", async () => {
    const transfer = transferFixture();
    transfer.groups[0].isRequired = true;
    transfer.groups[0].minSelections = 1;
    transfer.groups[0].options = [];
    const route = await import("./route");
    const response = await route.POST(importRequest(transfer, "PREVIEW"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      previewGroups: [{ name: "客製口味", changeType: "CREATE" }],
    });
  });

  it("套用時使用檔案內的商品指派排序，而不是陣列索引", async () => {
    const route = await import("./route");
    const response = await route.POST(importRequest(transferFixture(), "APPLY"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.upsertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ productId, sortOrder: 37 }),
      update: { sortOrder: 37, isActive: true },
    }));
  });
});

function importRequest(transfer: unknown, mode: "PREVIEW" | "APPLY") {
  const form = new FormData();
  form.set("productNotes", new File(
    [JSON.stringify(transfer)],
    "stallorder-product-notes.json",
    { type: "application/json" },
  ));
  form.set("mode", mode);
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/product-notes/import`, {
    method: "POST",
    body: form,
  });
}

function transferFixture() {
  return {
    schemaVersion: 1,
    exportedAt: "2026-08-05T00:00:00.000Z",
    sourceCurrency: "TWD",
    reusableNotes: [{
      name: "不加香菜",
      priceDelta: 10,
      sortOrder: 2,
      isActive: true,
      translations: [],
    }],
    groups: [{
      name: "客製口味",
      selectionMode: "MULTIPLE",
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
      sortOrder: 4,
      isActive: true,
      translations: [],
      products: [{ id: productId, name: "招牌河粉", sortOrder: 37 }],
      options: [{
        name: "不加香菜",
        reusableNoteName: "不加香菜",
        priceDelta: 10,
        sortOrder: 8,
        isActive: true,
        translations: [],
      }],
    }],
  };
}
