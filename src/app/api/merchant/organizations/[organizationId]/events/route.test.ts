import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  applyMarketEventCommand: vi.fn(),
  getMarketEventManagerData: vi.fn(),
  invalidatePublicData: vi.fn(),
  stallScheduleErrorResponse: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/lib/stall-schedule-http", () => ({
  noStoreHeaders: (requestId: string) => ({ "cache-control": "private, no-store", "x-request-id": requestId }),
  requireJsonContentType: vi.fn(() => null),
  stallScheduleErrorResponse: mocks.stallScheduleErrorResponse,
}));
vi.mock("@/lib/stall-schedules", () => ({
  applyMarketEventCommand: mocks.applyMarketEventCommand,
  getMarketEventManagerData: mocks.getMarketEventManagerData,
  invalidateOrganizationSchedulePublicData: mocks.invalidatePublicData,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.applyMarketEventCommand.mockResolvedValue({ id: eventId });
  mocks.getMarketEventManagerData.mockResolvedValue({ events: [] });
  mocks.stallScheduleErrorResponse.mockReturnValue(Response.json(
    { error: "目前無法更新市集活動。" },
    { status: 500 },
  ));
});

describe("市集活動 API 欄位錯誤", () => {
  it("精確回報經緯度與活動時間交叉欄位錯誤", async () => {
    const route = await import("./route");
    const response = await route.PATCH(eventRequest({
      ...validEvent("CREATE"),
      latitude: 25.05,
      longitude: null,
      startsAt: "2026-08-03T10:00:00+08:00",
      endsAt: "2026-08-03T09:00:00+08:00",
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors).toMatchObject({
      longitude: "經緯度必須同時填寫或同時留空。",
      endsAt: "活動結束時間必須晚於開始時間。",
    });
    expect(mocks.applyMarketEventCommand).not.toHaveBeenCalled();
  });

  it("以欄位錯誤回報空白與格式錯誤", async () => {
    const route = await import("./route");
    const response = await route.PATCH(eventRequest({
      ...validEvent("CREATE"),
      name: " ",
      slug: "Bad Slug",
      startsAt: "",
      endsAt: "",
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors).toEqual(expect.objectContaining({
      name: expect.stringMatching(/[\u3400-\u9fff]/u),
      slug: expect.stringMatching(/[\u3400-\u9fff]/u),
      startsAt: expect.stringMatching(/[\u3400-\u9fff]/u),
      endsAt: expect.stringMatching(/[\u3400-\u9fff]/u),
    }));
  });

  it("允許送出空白刪除原因並由 API 回報 reason", async () => {
    const route = await import("./route");
    const response = await route.PATCH(eventRequest({
      operation: "DELETE",
      eventId,
      reason: " ",
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors.reason).toMatch(/[\u3400-\u9fff]/u);
    expect(mocks.applyMarketEventCommand).not.toHaveBeenCalled();
  });

  it.each(["CREATE", "UPDATE"] as const)("把 %s 的 slug P2002 映射到活動代稱", async (operation) => {
    mocks.applyMarketEventCommand.mockRejectedValueOnce(uniqueError(["organization_id", "slug"]));
    const route = await import("./route");
    const response = await route.PATCH(eventRequest(validEvent(operation)), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "此活動代稱已被使用，請改用其他代稱。",
      fieldErrors: { slug: "此活動代稱已被使用，請改用其他代稱。" },
    });
  });

  it("不把未知 P2002 target 誤映射到活動代稱", async () => {
    mocks.applyMarketEventCommand.mockRejectedValueOnce(uniqueError(["audit_key"]));
    const route = await import("./route");
    const response = await route.PATCH(eventRequest(validEvent("CREATE")), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "目前無法更新市集活動。" });
  });
});

function validEvent(operation: "CREATE" | "UPDATE") {
  return {
    operation,
    ...(operation === "UPDATE" ? { eventId } : {}),
    name: "週末市集",
    slug: "weekend-market",
    description: null,
    venueName: "市民廣場",
    address: "台北市信義區",
    latitude: null,
    longitude: null,
    startsAt: "2026-08-03T10:00:00+08:00",
    endsAt: "2026-08-03T18:00:00+08:00",
    organizer: null,
    publicUrl: null,
    isPublic: true,
  };
}

function eventRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/events`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
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
