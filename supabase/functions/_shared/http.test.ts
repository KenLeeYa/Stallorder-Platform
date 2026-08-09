import { describe, expect, it } from "vitest";
import {
  errorMessage,
  getCorsHeaders,
  getGatewayClientIp,
  getPublicOrderOperationId,
  jsonResponse,
  PUBLIC_ORDER_OPERATION_ID_HEADER,
  statusForCode,
} from "./http";

describe("Edge 用戶端 IP", () => {
  it("只讀取部署時指定的可信標頭", () => {
    const request = new Request("https://order.example", {
      headers: {
        "cf-connecting-ip": "203.0.113.8",
        "x-forwarded-for": "198.51.100.2",
      },
    });
    expect(getGatewayClientIp(request, "cf-connecting-ip")).toBe("203.0.113.8");
  });

  it("拒絕轉送鏈與不合法 IP", () => {
    expect(getGatewayClientIp(new Request("https://order.example", {
      headers: { "x-real-ip": "203.0.113.8, 198.51.100.2" },
    }), "x-real-ip")).toBe("unknown");
    expect(getGatewayClientIp(new Request("https://order.example", {
      headers: { "x-real-ip": "attacker-controlled" },
    }), "x-real-ip")).toBe("unknown");
  });
});

describe("Edge 公開錯誤契約", () => {
  it("回傳安全且可操作的公開訊息", () => {
    expect(errorMessage("SUBSCRIPTION_SUSPENDED")).toContain("停權");
    expect(errorMessage("TRIAL_ORDER_LIMIT_REACHED")).not.toContain("organization");
  });

  it("使用一致的 HTTP 狀態碼", () => {
    expect(statusForCode("SUBSCRIPTION_SUSPENDED")).toBe(403);
    expect(statusForCode("TRIAL_ORDER_LIMIT_REACHED")).toBe(409);
    expect(statusForCode("QR_ORDERING_DEGRADED")).toBe(503);
    expect(statusForCode("QR_ORDERING_UNAVAILABLE")).toBe(503);
    expect(statusForCode("PREORDER_TIME_UNAVAILABLE")).toBe(409);
    expect(statusForCode("SESSION_TOKEN_COLLISION")).toBe(409);
    expect(statusForCode("INVALID_PRODUCT_BUNDLE")).toBe(422);
    expect(statusForCode("LOTTERY_RATE_LIMITED")).toBe(429);
    expect(statusForCode("FULFILLMENT_TIME_PROPOSAL_STALE")).toBe(409);
    expect(statusForCode("FULFILLMENT_TIME_SERVICE_UNAVAILABLE")).toBe(503);
  });

  it("涵蓋預約與工作階段的終止錯誤", () => {
    expect(errorMessage("PREORDER_TIME_UNAVAILABLE")).toContain("預約");
    expect(errorMessage("SESSION_TOKEN_COLLISION")).toContain("工作階段");
    expect(errorMessage("INVALID_PRODUCT_BUNDLE")).toContain("套餐");
    expect(errorMessage("LOTTERY_RATE_LIMITED")).toContain("抽抽樂");
    expect(errorMessage("FULFILLMENT_TIME_PROPOSAL_EXPIRED")).toContain("逾期");
  });
});

describe("Edge 公開訂單 operation id", () => {
  const origin = "https://app.qidaigo.com";
  const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("allows the request header and echoes it separately from request id", () => {
    const request = new Request("https://functions.example/create-order-session", {
      headers: {
        origin,
        [PUBLIC_ORDER_OPERATION_ID_HEADER]: operationId.toUpperCase(),
      },
    });
    const corsHeaders = getCorsHeaders(request, [origin]);
    const resolvedOperationId = getPublicOrderOperationId(request);
    const response = jsonResponse(
      { ok: true },
      200,
      corsHeaders,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      resolvedOperationId,
    );

    expect(corsHeaders["access-control-allow-headers"])
      .toContain(PUBLIC_ORDER_OPERATION_ID_HEADER);
    expect(corsHeaders["access-control-expose-headers"])
      .toContain(PUBLIC_ORDER_OPERATION_ID_HEADER);
    expect(resolvedOperationId).toBe(operationId);
    expect(response.headers.get(PUBLIC_ORDER_OPERATION_ID_HEADER)).toBe(operationId);
    expect(response.headers.get("x-request-id"))
      .toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("replaces an invalid external value with a valid server-generated id", () => {
    const resolvedOperationId = getPublicOrderOperationId(new Request(
      "https://functions.example/create-public-order",
      { headers: { [PUBLIC_ORDER_OPERATION_ID_HEADER]: "invalid" } },
    ));

    expect(resolvedOperationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
