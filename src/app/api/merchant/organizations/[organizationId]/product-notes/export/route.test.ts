import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  findOrganization: vi.fn(),
  findReusableNotes: vi.fn(),
  findGroups: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: mocks.findOrganization },
    reusableProductNote: { findMany: mocks.findReusableNotes },
    productNoteGroup: { findMany: mocks.findGroups },
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
  mocks.authorize.mockResolvedValue({ ok: true, requestId: "request-1" });
  mocks.assertFeatureEnabled.mockResolvedValue(undefined);
  mocks.findOrganization.mockResolvedValue({ defaultCurrency: "TWD" });
  mocks.findReusableNotes.mockResolvedValue([]);
  mocks.findGroups.mockResolvedValue([groupFixture()]);
});

describe("商品註記匯出 API", () => {
  it("匯出資料庫幣別及商品指派排序，且不因停用群組尚未可供點餐而失敗", async () => {
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/export"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.sourceCurrency).toBe("TWD");
    expect(payload.groups[0]).toMatchObject({
      isActive: false,
      minSelections: 1,
      products: [{ id: productId, name: "招牌河粉", sortOrder: 37 }],
    });
  });

  it("以受控錯誤拒絕超過共用 aggregate 契約的匯出，不產生無界檔案或 500", async () => {
    mocks.findGroups.mockResolvedValue(Array.from({ length: 6 }, (_, groupIndex) => ({
      ...groupFixture(),
      name: `群組${groupIndex}`,
      options: Array.from({ length: 200 }, (_, optionIndex) => ({
        name: `註記${groupIndex}-${optionIndex}`,
        reusableNoteId: null,
        priceDelta: 0,
        sortOrder: optionIndex,
        isActive: true,
        translations: [],
      })),
    })));
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/export"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "註記群組：單次最多可包含 1,000 個群組註記。",
    });
  });
});

function groupFixture() {
  return {
    name: "暫停使用群組",
    selectionMode: "MULTIPLE",
    isRequired: true,
    minSelections: 1,
    maxSelections: 2,
    sortOrder: 1,
    isActive: false,
    translations: [],
    assignments: [{
      sortOrder: 37,
      product: { id: productId, name: "招牌河粉" },
    }],
    options: [],
  };
}
