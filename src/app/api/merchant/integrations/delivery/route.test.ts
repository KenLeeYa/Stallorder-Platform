import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryPlatformError } from "@/server/delivery-platforms/delivery-platform-errors";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  deliveryApiErrorResponse: vi.fn(),
  getIntegrationData: vi.fn(),
  submitRequest: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/delivery-platforms/connection-service", () => ({
  getMerchantDeliveryIntegrationData: mocks.getIntegrationData,
  submitDeliveryConnectionRequest: mocks.submitRequest,
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

const stallId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";

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
  mocks.submitRequest.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" });
});

describe("POST /api/merchant/integrations/delivery", () => {
  it("回傳所有空白與格式錯誤，包含一至五碼聯絡電話", async () => {
    const route = await import("./route");
    const response = await route.POST(request({
      stallId,
      provider: "UNKNOWN",
      merchantContactName: " ",
      merchantContactEmail: "invalid-email",
      merchantContactPhone: "12345",
      externalVendorCode: "v".repeat(121),
      externalChainCode: "c".repeat(121),
      currentProvider: "p".repeat(121),
      requestedCapabilities: [],
      merchantNote: "n".repeat(2001),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "申請資料格式不正確，請檢查標示欄位。",
      fieldErrors: {
        provider: "「外送平台」輸入不正確，請依欄位限制重新輸入。",
        merchantContactName: "「聯絡人姓名」輸入不正確，請依欄位限制重新輸入。",
        merchantContactEmail: "「聯絡電子郵件」輸入不正確，請依欄位限制重新輸入。",
        merchantContactPhone: "「聯絡電話」輸入不正確，請依欄位限制重新輸入。",
        externalVendorCode: "「Vendor Code」輸入不正確，請依欄位限制重新輸入。",
        externalChainCode: "「Chain Code」輸入不正確，請依欄位限制重新輸入。",
        currentProvider: "「目前使用的點餐系統」輸入不正確，請依欄位限制重新輸入。",
        requestedCapabilities: "「預計使用功能」輸入不正確，請依欄位限制重新輸入。",
        merchantNote: "「補充說明」輸入不正確，請依欄位限制重新輸入。",
      },
    });
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.submitRequest).not.toHaveBeenCalled();
  });

  it("將重複的進行中申請精確映射至外送平台欄位", async () => {
    mocks.submitRequest.mockRejectedValue(
      new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false }),
    );
    const route = await import("./route");
    const response = await route.POST(request(validRequestBody()));

    const message = "此攤位已有進行中的同平台連線申請，請勿重複送出。";
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: message,
      code: "CONNECTION_STATE_CONFLICT",
      fieldErrors: { provider: message },
    });
    expect(mocks.deliveryApiErrorResponse).not.toHaveBeenCalled();
  });
});

function request(body: unknown) {
  return new Request("https://example.test/api/merchant/integrations/delivery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validRequestBody() {
  return {
    stallId,
    provider: "UBER_EATS",
    merchantContactName: "王小明",
    merchantContactEmail: "merchant@example.com",
    merchantContactPhone: null,
    externalVendorCode: null,
    externalChainCode: null,
    currentProvider: null,
    requestedCapabilities: ["ORDER_WEBHOOK"],
    merchantNote: null,
  };
}
