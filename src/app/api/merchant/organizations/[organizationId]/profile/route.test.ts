import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  transaction: vi.fn(),
  findOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const validProfile = {
  businessName: "阿宏河粉",
  email: "owner@example.com",
  phone: "0916-166-504",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.findOrganization.mockResolvedValue(validProfile);
  mocks.updateOrganization.mockResolvedValue(validProfile);
  mocks.transaction.mockImplementation(async (operation) => operation({
    organization: {
      findUnique: mocks.findOrganization,
      update: mocks.updateOrganization,
    },
  }));
});

describe("組織基本資料 API 欄位錯誤", () => {
  it("以繁中欄位錯誤回報空白與格式錯誤", async () => {
    const route = await import("./route");
    const response = await route.PATCH(profileRequest({
      businessName: " ",
      email: "not-an-email",
      phone: "x",
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(Object.keys(payload.fieldErrors)).toEqual(["businessName", "email", "phone"]);
    expect(payload.fieldErrors.businessName).toMatch(/[\u3400-\u9fff]/u);
    expect(payload.fieldErrors.email).toMatch(/[\u3400-\u9fff]/u);
    expect(payload.fieldErrors.phone).toMatch(/[\u3400-\u9fff]/u);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("只把 email 唯一衝突映射到 email 欄位", async () => {
    mocks.transaction.mockRejectedValueOnce(uniqueError(["email"]));
    const route = await import("./route");
    const response = await route.PATCH(profileRequest(validProfile), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "此聯絡電子郵件已由其他商家使用。",
      fieldErrors: { email: "此聯絡電子郵件已由其他商家使用。" },
    });
  });

  it("不把未知 P2002 target 誤映射到 email", async () => {
    mocks.transaction.mockRejectedValueOnce(uniqueError(["auditKey"]));
    const route = await import("./route");
    const response = await route.PATCH(profileRequest(validProfile), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "目前無法更新商家資料。" });
  });
});

function profileRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function uniqueError(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}
