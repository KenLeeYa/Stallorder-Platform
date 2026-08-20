import { beforeEach, describe, expect, it, vi } from "vitest";

const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  transaction: vi.fn(),
  stallFindFirst: vi.fn(),
  stallUpdate: vi.fn(),
  qrFindMany: vi.fn(),
  recordAuditEvent: vi.fn(),
  invalidatePublicMenu: vi.fn(),
  invalidatePublicQrToken: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeStallManagementApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/public-menu", () => ({
  invalidatePublicMenu: mocks.invalidatePublicMenu,
  invalidatePublicQrToken: mocks.invalidatePublicQrToken,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    qrCode: { findMany: mocks.qrFindMany },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-id",
    principal: { user: { id: "33333333-3333-4333-8333-333333333333" } },
    workspace: { id: organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.stallFindFirst.mockResolvedValue(stallRecord({ code: "FIXED-CODE" }));
  mocks.stallUpdate.mockResolvedValue(stallRecord({ code: "FIXED-CODE" }));
  mocks.qrFindMany.mockResolvedValue([]);
  mocks.recordAuditEvent.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (operation) => operation({
    stall: {
      findFirst: mocks.stallFindFirst,
      update: mocks.stallUpdate,
    },
  }));
});

describe("merchant stall code immutability", () => {
  it("rejects an attempted existing-code change inside the transaction", async () => {
    mocks.readJson.mockResolvedValue({ data: basicCommand({ code: "CHANGED-CODE" }) });

    const response = await patchStall();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "攤位代碼建立後無法變更。",
      fieldErrors: {
        code: "為確保公開商店網址穩定，既有攤位代碼已鎖定，無法變更。",
      },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.stallUpdate).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.qrFindMany).not.toHaveBeenCalled();
  });

  it("accepts the same normalized code but never writes the code column", async () => {
    mocks.stallFindFirst.mockResolvedValue(stallRecord({ code: "Fixed-Code" }));
    mocks.readJson.mockResolvedValue({ data: basicCommand({ code: "fixed-code" }) });

    const response = await patchStall();

    expect(response.status).toBe(200);
    expect(mocks.stallUpdate).toHaveBeenCalledTimes(1);
    const update = mocks.stallUpdate.mock.calls[0]?.[0];
    expect(update).toMatchObject({
      where: { id: stallId, organizationId },
      data: {
        name: "測試攤位",
        description: "",
        address: "台北市測試路 1 號",
        location: "台北市測試路 1 號",
        phone: "",
        timezone: "Asia/Taipei",
        currency: "TWD",
      },
    });
    expect(update.data).not.toHaveProperty("code");
  });
});

function basicCommand(overrides: Record<string, unknown> = {}) {
  return {
    operation: "UPDATE_BASIC",
    name: "測試攤位",
    code: "FIXED-CODE",
    description: "",
    address: "台北市測試路 1 號",
    phone: "",
    timezone: "Asia/Taipei",
    currency: "TWD",
    ...overrides,
  };
}

function stallRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: stallId,
    name: "測試攤位",
    code: "FIXED-CODE",
    description: "",
    address: "台北市測試路 1 號",
    phone: "",
    timezone: "Asia/Taipei",
    currency: "TWD",
    businessStatus: "OPEN",
    orderingEnabled: true,
    isActive: true,
    ...overrides,
  };
}

async function patchStall() {
  const route = await import("./route");
  return route.PATCH(
    new Request(`https://local.test/api/merchant/stalls/${stallId}`, {
      method: "PATCH",
      body: "{}",
    }),
    { params: Promise.resolve({ stallId }) },
  );
}
