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

describe("Edge 訂閱錯誤", () => {
  it("回傳安全且可操作的公開訊息", () => {
    expect(errorMessage("SUBSCRIPTION_SUSPENDED")).toContain("停權");
    expect(errorMessage("TRIAL_ORDER_LIMIT_REACHED")).not.toContain("organization");
  });

  it("使用一致的 HTTP 狀態碼", () => {
    expect(statusForCode("SUBSCRIPTION_SUSPENDED")).toBe(403);
    expect(statusForCode("TRIAL_ORDER_LIMIT_REACHED")).toBe(409);
    expect(statusForCode("QR_ORDERING_DEGRADED")).toBe(503);
    expect(statusForCode("QR_ORDERING_UNAVAILABLE")).toBe(503);
  });
});
