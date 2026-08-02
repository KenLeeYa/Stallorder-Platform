import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryPlatformError } from "@/server/delivery-platforms/delivery-platform-errors";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  deliveryApiErrorResponse: vi.fn(),
  findScopedConnection: vi.fn(),
  listMappings: vi.fn(),
  upsertMapping: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/delivery-platforms/delivery-platform-repository", () => ({
  deliveryPlatformRepository: { findScopedConnection: mocks.findScopedConnection },
}));
vi.mock("@/server/delivery-platforms/delivery-http", () => ({
  authorizeMerchantDeliveryApi: mocks.authorize,
  deliveryApiErrorResponse: mocks.deliveryApiErrorResponse,
  deliveryNoStoreHeaders: (requestId?: string) => ({
    "cache-control": "private, no-store, max-age=0",
    ...(requestId ? { "x-request-id": requestId } : {}),
  }),
  validateDeliveryCsrf: mocks.validateCsrf,
}));
vi.mock("@/server/delivery-platforms/menu-mapping-service", () => ({
  listExternalMenuMappings: mocks.listMappings,
  upsertExternalMenuMapping: mocks.upsertMapping,
}));

const stallId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";
const connectionId = "44444444-4444-4444-8444-444444444444";
const internalEntityId = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    workspace: { id: organizationId },
    principal: { user: { id: profileId } },
  });
  mocks.validateCsrf.mockReturnValue(null);
  mocks.deliveryApiErrorResponse.mockReturnValue(null);
  mocks.findScopedConnection.mockResolvedValue({ id: connectionId, provider: "UBER_EATS" });
  mocks.upsertMapping.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
});

describe("PUT /api/merchant/integrations/delivery/[connectionId]/menu-mapping", () => {
  it("回傳所有空白與格式錯誤", async () => {
    const route = await import("./route");
    const response = await route.PUT(request({
      internalEntityType: "UNKNOWN",
      internalEntityId: "",
      externalEntityId: " ",
      externalParentId: "p".repeat(201),
    }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "商品對應資料格式不正確，請檢查標示欄位。",
      fieldErrors: {
        internalEntityType: "「資料類型」輸入不正確，請依欄位限制重新輸入。",
        internalEntityId: "「攤點通項目」輸入不正確，請依欄位限制重新輸入。",
        externalEntityId: "「外送平台項目 ID」輸入不正確，請依欄位限制重新輸入。",
        externalParentId: "「外送平台上層 ID」輸入不正確，請依欄位限制重新輸入。",
      },
    });
    expect(mocks.upsertMapping).not.toHaveBeenCalled();
  });

  it("將資料類型與項目不相符精確映射至攤點通項目", async () => {
    mocks.upsertMapping.mockRejectedValue(
      new DeliveryPlatformError("UNSUPPORTED_MAPPING", { retryable: false }),
    );
    const route = await import("./route");
    const response = await route.PUT(request(validMappingBody()), context());

    const message = "找不到所選的攤點通項目，請重新選擇。";
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: message,
      code: "UNSUPPORTED_MAPPING",
      fieldErrors: { internalEntityId: message },
    });
  });

  it("將外部唯一鍵衝突精確映射至外送平台項目 ID", async () => {
    mocks.upsertMapping.mockRejectedValue(p2002("external_menu_mappings_external_key"));
    const route = await import("./route");
    const response = await route.PUT(request(validMappingBody()), context());

    const message = "此外送平台項目 ID 已對應其他攤點通項目。";
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: message,
      fieldErrors: { externalEntityId: message },
    });
  });

  it("將內部唯一鍵衝突精確映射至攤點通項目", async () => {
    mocks.upsertMapping.mockRejectedValue(p2002("external_menu_mappings_internal_key"));
    const route = await import("./route");
    const response = await route.PUT(request(validMappingBody()), context());

    const message = "此攤點通項目已建立對應，請重新整理後再試。";
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: message,
      fieldErrors: { internalEntityId: message },
    });
  });

  it("未知 P2002 target 不會誤映射至任何欄位", async () => {
    mocks.upsertMapping.mockRejectedValue(p2002(["connection_id", "provider"]));
    const route = await import("./route");
    const response = await route.PUT(request(validMappingBody()), context());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "目前無法儲存商品對應。" });
  });
});

function request(body: unknown) {
  return new Request(
    `https://example.test/api/merchant/integrations/delivery/${connectionId}/menu-mapping?stallId=${stallId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context() {
  return { params: Promise.resolve({ connectionId }) };
}

function validMappingBody() {
  return {
    internalEntityType: "PRODUCT",
    internalEntityId,
    externalEntityId: "provider-item-1",
    externalParentId: null,
  };
}

function p2002(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}
