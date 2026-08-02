import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  updateMany: vi.fn(),
  createInvitation: vi.fn(),
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
  prisma: {
    organizationInvitation: {
      updateMany: mocks.updateMany,
      create: mocks.createInvitation,
    },
  },
}));
vi.mock("@/lib/security", () => ({
  createOpaqueToken: vi.fn(() => "one-time-token"),
  hashClientIp: vi.fn(() => "ip-hash"),
  hashToken: vi.fn(() => "hashed-token"),
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  setAuthorization(["ORGANIZATION_OWNER"], [stallId]);
  mocks.validateCsrf.mockReturnValue(true);
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.createInvitation.mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    email: "member@example.com",
    role: "STAFF",
    stallId,
    status: "PENDING",
    expiresAt: new Date("2026-08-10T00:00:00.000Z"),
  });
});

describe("組織邀請 API 欄位錯誤", () => {
  it("以繁中 email 欄位錯誤回報空白或格式錯誤", async () => {
    const route = await import("./route");
    const response = await route.POST(invitationRequest({
      email: "not-an-email",
      role: "STAFF",
      stallId,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors.email).toMatch(/[\u3400-\u9fff]/u);
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it("把攤位角色缺少攤位精確映射到 stallId", async () => {
    const route = await import("./route");
    const response = await route.POST(invitationRequest({
      email: "member@example.com",
      role: "STAFF",
      stallId: null,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "請選擇可指派的攤位。",
      fieldErrors: { stallId: "請選擇可指派的攤位。" },
    });
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it("把組織角色夾帶攤位精確映射到 stallId", async () => {
    const route = await import("./route");
    const response = await route.POST(invitationRequest({
      email: "admin@example.com",
      role: "ORGANIZATION_ADMIN",
      stallId,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "組織角色的攤位範圍必須為全部攤位。",
      fieldErrors: { stallId: "組織角色的攤位範圍必須為全部攤位。" },
    });
  });

  it("把無權指派的組織角色精確映射到 role", async () => {
    setAuthorization(["STAFF"], [stallId]);
    const route = await import("./route");
    const response = await route.POST(invitationRequest({
      email: "admin@example.com",
      role: "ORGANIZATION_ADMIN",
      stallId: null,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "您沒有指派此組織角色的權限。",
      fieldErrors: { role: "您沒有指派此組織角色的權限。" },
    });
  });

  it("只把待接受邀請複合索引 P2002 映射到三個衝突欄位", async () => {
    mocks.createInvitation.mockRejectedValueOnce(uniqueError("organization_invitations_pending_idx"));
    const route = await import("./route");
    const response = await route.POST(invitationRequest(validInvitation()), {
      params: Promise.resolve({ organizationId }),
    });

    const message = "此 Email 已有相同範圍與角色的待接受邀請。";
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: message,
      fieldErrors: { email: message, role: message, stallId: message },
    });
  });

  it("不把 token_hash P2002 誤映射到邀請輸入", async () => {
    mocks.createInvitation.mockRejectedValueOnce(uniqueError(["token_hash"]));
    const route = await import("./route");
    const response = await route.POST(invitationRequest(validInvitation()), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "目前無法建立邀請。" });
  });
});

function setAuthorization(roles: string[], authorizedStallIds: string[]) {
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: { roles },
    authorizedStallIds,
  });
}

function validInvitation() {
  return { email: "member@example.com", role: "STAFF", stallId };
}

function invitationRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/invitations`, {
    method: "POST",
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
