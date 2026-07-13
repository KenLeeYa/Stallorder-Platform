import { describe, expect, it } from "vitest";
import { createStallSchema, updateStallSchema } from "./stall-validation";

const validCreate = {
  name: "第二攤",
  code: "stall-02",
  slug: "stall-two",
  description: "",
  address: "台北市測試路二號",
  phone: "",
  timezone: "Asia/Taipei",
  currency: "twd",
};

describe("攤位資料驗證", () => {
  it("正規化攤位代碼與幣別", () => {
    const parsed = createStallSchema.parse(validCreate);
    expect(parsed.code).toBe("STALL-02");
    expect(parsed.currency).toBe("TWD");
  });

  it("拒絕客戶端夾帶 organizationId", () => {
    expect(createStallSchema.safeParse({ ...validCreate, organizationId: crypto.randomUUID() }).success).toBe(false);
  });

  it("拒絕無效時區", () => {
    expect(createStallSchema.safeParse({ ...validCreate, timezone: "Taipei/Unknown" }).success).toBe(false);
  });

  it("停用攤位必須提供明確確認值", () => {
    const update = {
      ...validCreate,
      businessStatus: "CLOSED",
      orderingEnabled: false,
      isActive: false,
    };
    delete (update as Partial<typeof update>).slug;
    expect(updateStallSchema.safeParse(update).success).toBe(false);
    expect(updateStallSchema.safeParse({ ...update, confirmation: "DEACTIVATE" }).success).toBe(true);
  });
});
