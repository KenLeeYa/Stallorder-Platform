import { describe, expect, it } from "vitest";
import { publicEdgeUrl } from "./public-order-client";

describe("publicEdgeUrl", () => {
  it("使用同站 API proxy 呼叫公開點餐 Function", () => {
    expect(publicEdgeUrl("create-order-session")).toBe("/api/public-order/create-order-session");
  });
});
