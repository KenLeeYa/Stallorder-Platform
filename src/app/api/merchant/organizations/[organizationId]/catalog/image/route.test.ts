import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  optimizeProductImage: vi.fn(),
  storageUpload: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/lib/product-image-processing", () => ({
  optimizeProductImage: mocks.optimizeProductImage,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({ upload: mocks.storageUpload })),
    },
  })),
}));
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
  mocks.optimizeProductImage.mockResolvedValue(Buffer.from("optimized-image"));
  mocks.storageUpload.mockResolvedValue({ error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-secret");
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

  it("儲存服務連線失敗時仍回傳 JSON 錯誤契約", async () => {
    mocks.storageUpload.mockRejectedValueOnce(new Error("fetch failed"));
    const response = await uploadPng();

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    await expect(response.json()).resolves.toEqual({ error: "圖片上傳失敗，請稍後再試。" });
  });

  it("圖片成功最佳化並寫入儲存服務時回傳可用網址", async () => {
    const response = await uploadPng();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      imageUrl: expect.stringContaining("/api/assets/product-images/"),
      originalSize: 8,
      optimizedSize: 15,
    });
  });
});

async function uploadPng() {
  const form = new FormData();
  form.set("image", new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "menu.png",
    { type: "image/png" },
  ));
  form.set("positionX", "50");
  form.set("positionY", "50");
  form.set("zoom", "100");
  const route = await import("./route");
  return route.POST(new Request(
    `https://example.test/api/merchant/organizations/${organizationId}/catalog/image`,
    { method: "POST", body: form },
  ), { params: Promise.resolve({ organizationId }) });
}
