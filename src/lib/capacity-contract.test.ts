import { describe, expect, it } from "vitest";
import {
  capacityCapabilities,
  capacityMerchantCommandSchema,
  capacityStaffCommandSchema,
  formatWaitQuote,
  getCapacityFieldErrors,
  parseCapacitySnapshot,
} from "@/lib/capacity-contract";

describe("capacity contract", () => {
  it("拒絕不一致的容量門檻", () => {
    const result = capacityMerchantCommandSchema.safeParse({
      operation: "UPDATE_SETTINGS",
      windowMinutes: 15,
      maxOrdersPerWindow: 20,
      maxItemsPerWindow: 60,
      warningUtilizationPercent: 90,
      pauseUtilizationPercent: 80,
      defaultPrepMinutes: 10,
      minimumQuoteMinutes: 5,
      maximumQuoteMinutes: 120,
      quoteBufferMinutes: 3,
      acknowledgmentThresholdMinutes: 30,
      autoPauseEnabled: true,
      autoResumeEnabled: true,
      isActive: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(getCapacityFieldErrors(result.error)).toMatchObject({
        pauseUtilizationPercent: "自動暫停門檻必須高於警示門檻。",
      });
    }
  });

  it("將數值格式錯誤轉為繁體中文欄位提示", () => {
    const result = capacityMerchantCommandSchema.safeParse({
      operation: "UPSERT_PRODUCT_RULE",
      productId: crypto.randomUUID(),
      capacityWeight: "",
      prepMinutes: 10,
      maxQuantityPerWindow: null,
      isActive: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(getCapacityFieldErrors(result.error).capacityWeight).toContain("產能權重");
    }
  });

  it("現場操作必須附上原因", () => {
    expect(capacityStaffCommandSchema.safeParse({
      operation: "PAUSE_ORDERING",
      reason: "",
    }).success).toBe(false);
  });

  it("只信任明確啟用的方案能力", () => {
    expect(capacityCapabilities({ automaticControl: true, productRules: false })).toEqual({
      automaticControl: true,
      productRules: false,
    });
    expect(capacityCapabilities("invalid")).toEqual({
      automaticControl: false,
      productRules: false,
    });
  });

  it("將資料庫 JSON 投影為穩定且不含商品識別碼的快照", () => {
    const snapshot = parseCapacitySnapshot({
      quote_min_minutes: 15,
      quote_max_minutes: 20,
      utilization_percent: 82.5,
      pause_source: "AUTO",
      product_limit_exceeded: true,
      product_limit_product_id: "should-not-leak",
      accepting_public_orders: false,
    });
    expect(snapshot.quoteMinMinutes).toBe(15);
    expect(snapshot.utilizationPercent).toBe(82.5);
    expect(snapshot.pauseSource).toBe("AUTO");
    expect(snapshot.productLimitExceeded).toBe(true);
    expect(snapshot).not.toHaveProperty("productLimitProductId");
  });

  it("顯示單一或區間等候時間", () => {
    expect(formatWaitQuote(15, 15)).toBe("15 分鐘");
    expect(formatWaitQuote(15, 20)).toBe("15～20 分鐘");
  });
});
