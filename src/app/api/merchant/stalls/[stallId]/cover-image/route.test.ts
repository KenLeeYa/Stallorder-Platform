import { beforeEach, describe, expect, it, vi } from "vitest";

const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  optimizeProductImage: vi.fn(),
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  stallFindUnique: vi.fn(),
  stallUpdate: vi.fn(),
  stallUpdateMany: vi.fn(),
  transaction: vi.fn(),
  qrFindMany: vi.fn(),
  enqueueReplication: vi.fn(),
  enqueueDeletion: vi.fn(),
  recordAuditEvent: vi.fn(),
  ProductImageProcessingBusyError: class ProductImageProcessingBusyError extends Error {},
  ProductImageProcessorUnavailableError: class ProductImageProcessorUnavailableError extends Error {},
}));

vi.mock("@/lib/authorization", () => ({
  authorizeStallManagementApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/public-menu", () => ({
  invalidatePublicMenu: vi.fn(),
  invalidatePublicQrToken: vi.fn(),
}));
vi.mock("@/lib/product-image-processing", () => ({
  optimizeProductImage: mocks.optimizeProductImage,
  withProductImageProcessingSlot: (_organizationId: string, task: () => Promise<Buffer>) => task(),
  ProductImageProcessingBusyError: mocks.ProductImageProcessingBusyError,
  ProductImageProcessorUnavailableError: mocks.ProductImageProcessorUnavailableError,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mocks.storageUpload,
        remove: mocks.storageRemove,
      })),
    },
  })),
}));
vi.mock("@/server/resilience/storage-replication-service", () => ({
  enqueueStorageReplication: mocks.enqueueReplication,
  enqueueStorageDeletion: mocks.enqueueDeletion,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stall: { findUnique: mocks.stallFindUnique, update: mocks.stallUpdate },
    qrCode: { findMany: mocks.qrFindMany },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-id",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: { id: organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.optimizeProductImage.mockResolvedValue(Buffer.from("optimized-image"));
  mocks.storageUpload.mockResolvedValue({ error: null });
  mocks.storageRemove.mockResolvedValue({ error: null });
  mocks.stallFindUnique.mockResolvedValue({ coverImageUrl: null, locationGuideImageUrl: null });
  mocks.stallUpdate.mockResolvedValue({
    locationGuideImageUrl: "/api/assets/product-images/location-guide.webp",
    locationGuideImagePositionX: 35,
    locationGuideImagePositionY: 70,
    locationGuideImageZoom: 140,
  });
  mocks.stallUpdateMany.mockResolvedValue({ count: 1 });
  mocks.qrFindMany.mockResolvedValue([]);
  mocks.enqueueReplication.mockResolvedValue("replication-1");
  mocks.enqueueDeletion.mockResolvedValue("deletion-1");
  mocks.recordAuditEvent.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (operation) => operation({
    stall: { updateMany: mocks.stallUpdateMany },
  }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-secret");
});

describe("攤位圖片併發更新", () => {
  it("更新條件已失效時回傳 409 並排程清除剛上傳的物件", async () => {
    mocks.stallUpdateMany.mockResolvedValueOnce({ count: 0 });

    const response = await uploadCoverImage();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "圖片已被其他操作更新，請重新整理後再試。",
    });
    expect(mocks.stallUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: stallId, organizationId, coverImageUrl: null },
    }));
    expect(mocks.enqueueDeletion).toHaveBeenCalledOnce();
    expect(mocks.enqueueDeletion).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      bucket: "product-images",
      objectPath: expect.stringMatching(new RegExp(`^${organizationId}/stall-banners/${stallId}/[0-9a-f-]{36}\\.webp$`, "i")),
    }));
    expect(mocks.qrFindMany).not.toHaveBeenCalled();
  });

  it("刪除條件已失效時不會刪除另一個請求留下的物件", async () => {
    const oldPath = `${organizationId}/stall-banners/${stallId}/00000000-0000-4000-8000-000000000001.webp`;
    mocks.stallFindUnique.mockResolvedValueOnce({
      coverImageUrl: `/api/assets/product-images/${oldPath}`,
      locationGuideImageUrl: null,
    });
    mocks.stallUpdateMany.mockResolvedValueOnce({ count: 0 });
    const route = await import("./route");

    const response = await route.DELETE(new Request(
      `https://example.test/api/merchant/stalls/${stallId}/cover-image`,
      { method: "DELETE" },
    ), { params: Promise.resolve({ stallId }) });

    expect(response.status).toBe(409);
    expect(mocks.enqueueDeletion).not.toHaveBeenCalled();
    expect(mocks.qrFindMany).not.toHaveBeenCalled();
  });
});

describe("地點指引圖顯示範圍", () => {
  it("可獨立儲存位置與縮放，不會改動文宣圖片設定", async () => {
    const route = await import("./route");

    const response = await route.PATCH(new Request(
      `https://example.test/api/merchant/stalls/${stallId}/cover-image?slot=location-guide`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionX: 35, positionY: 70, zoom: 140 }),
      },
    ), { params: Promise.resolve({ stallId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      imageUrl: "/api/assets/product-images/location-guide.webp",
      positionX: 35,
      positionY: 70,
      zoom: 140,
    });
    expect(mocks.stallUpdate).toHaveBeenCalledWith({
      where: { id: stallId, organizationId },
      data: {
        locationGuideImagePositionX: 35,
        locationGuideImagePositionY: 70,
        locationGuideImageZoom: 140,
      },
      select: {
        locationGuideImageUrl: true,
        locationGuideImagePositionX: true,
        locationGuideImagePositionY: true,
        locationGuideImageZoom: true,
      },
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "STALL_LOCATION_GUIDE_IMAGE_CROP_UPDATED",
      metadata: { positionX: 35, positionY: 70, zoom: 140 },
    }));
  });
});

async function uploadCoverImage() {
  const form = new FormData();
  form.set("image", new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "cover.png",
    { type: "image/png" },
  ));
  const route = await import("./route");
  return route.POST(new Request(
    `https://example.test/api/merchant/stalls/${stallId}/cover-image`,
    { method: "POST", body: form },
  ), { params: Promise.resolve({ stallId }) });
}
