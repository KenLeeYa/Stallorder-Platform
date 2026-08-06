import { describe, expect, it } from "vitest";
import { errorMessage, getGatewayClientIp, statusForCode } from "./http";

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
