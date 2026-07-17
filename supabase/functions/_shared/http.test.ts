import { describe, expect, it } from "vitest";
import { getGatewayClientIp } from "./http";

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
