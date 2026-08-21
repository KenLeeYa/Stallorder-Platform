import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/resilience/storage-replication-service", () => ({
  enqueueStorageReplication: vi.fn(),
}));

const organizationId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
  });
  mocks.validateCsrf.mockReturnValue(true);
});

describe("商品圖片上傳 API", () => {
  it("在進入圖片處理前拒絕超過 5MB 的檔案", async () => {
    const form = new FormData();
    form.set("image", new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      "oversized.jpg",
      { type: "image/jpeg" },
    ));
    const route = await import("./route");
    const response = await route.POST(new Request(
      `https://example.test/api/merchant/organizations/${organizationId}/catalog/image`,
      { method: "POST", body: form },
    ), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "請上傳 5MB 以下的 JPG、PNG 或 WebP 圖片；系統會自動轉為適合 Menu 顯示的 WebP。",
    });
  });
});
