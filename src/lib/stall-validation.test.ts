import { describe, expect, it } from "vitest";
import {
  createStallSchema,
  getCreateStallConflictFieldErrors,
  getStallFieldErrors,
  updateStallSchema,
} from "./stall-validation";

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

  it("建立與更新均接受 50 字元代碼並拒絕 51 字元", () => {
    const code50 = "A".repeat(50);
    const basicUpdate = {
      operation: "UPDATE_BASIC" as const,
      name: validCreate.name,
      code: code50,
      description: validCreate.description,
      address: validCreate.address,
      phone: validCreate.phone,
      timezone: validCreate.timezone,
      currency: validCreate.currency,
    };

    expect(createStallSchema.safeParse({ ...validCreate, code: code50 }).success).toBe(true);
    expect(updateStallSchema.safeParse(basicUpdate).success).toBe(true);
    expect(createStallSchema.safeParse({ ...validCreate, code: `${code50}A` }).success).toBe(false);
    expect(updateStallSchema.safeParse({ ...basicUpdate, code: `${code50}A` }).success).toBe(false);
  });

  it("拒絕客戶端夾帶 organizationId", () => {
    expect(createStallSchema.safeParse({ ...validCreate, organizationId: crypto.randomUUID() }).success).toBe(false);
  });

  it("拒絕無效時區", () => {
    expect(createStallSchema.safeParse({ ...validCreate, timezone: "Taipei/Unknown" }).success).toBe(false);
  });

  it("回傳可直接顯示的繁中欄位錯誤", () => {
    const result = createStallSchema.safeParse({ ...validCreate, code: "中文代碼", phone: "abc" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(getStallFieldErrors(result.error)).toMatchObject({
      code: "攤位代碼僅可使用英文字母、數字與連字號。",
      phone: "電話需為 6～30 個字元，僅可包含數字、空格、括號、連字號與開頭的 +，或留空不填。",
    });
  });

  it("依唯一鍵 target 只標示真正衝突的建立欄位", () => {
    expect(getCreateStallConflictFieldErrors(["organization_id", "code"])).toEqual({
      code: "此攤位代碼已被使用，請改用其他代碼。",
    });
    expect(getCreateStallConflictFieldErrors("stalls_code_lower_unique_idx")).toEqual({
      code: "此攤位代碼已被使用，請改用其他代碼。",
    });
    expect(getCreateStallConflictFieldErrors("stalls_code_lower_guard")).toEqual({
      code: "此攤位代碼已被使用，請改用其他代碼。",
    });
    expect(getCreateStallConflictFieldErrors("stalls_slug_key")).toEqual({
      slug: "此公開識別名稱已被使用，請改用其他名稱。",
    });
    expect(getCreateStallConflictFieldErrors("qr_codes_token_key")).toEqual({
      code: "攤位代碼或公開識別名稱已被使用，請改用其他值。",
      slug: "攤位代碼或公開識別名稱已被使用，請改用其他值。",
    });
    expect(getCreateStallConflictFieldErrors(undefined)).toEqual({
      code: "攤位代碼或公開識別名稱已被使用，請改用其他值。",
      slug: "攤位代碼或公開識別名稱已被使用，請改用其他值。",
    });
  });

  it.each(["-stall", "stall-", "STALL", "攤位一號"])("拒絕無效公開識別名稱：%s", (slug) => {
    expect(createStallSchema.safeParse({ ...validCreate, slug }).success).toBe(false);
  });

  it("停用攤位必須提供明確確認值", () => {
    const update = {
      operation: "UPDATE_OPERATIONS" as const,
      businessStatus: "CLOSED",
      orderingEnabled: false,
      isActive: false,
    };
    expect(updateStallSchema.safeParse(update).success).toBe(false);
    expect(updateStallSchema.safeParse({ ...update, confirmation: "DEACTIVATE" }).success).toBe(true);
  });

  it("基本資料與營運狀態只能更新各自欄位", () => {
    const basicUpdate = {
      operation: "UPDATE_BASIC" as const,
      name: validCreate.name,
      code: validCreate.code,
      description: validCreate.description,
      address: validCreate.address,
      phone: validCreate.phone,
      timezone: validCreate.timezone,
      currency: validCreate.currency,
    };
    const operationsUpdate = {
      operation: "UPDATE_OPERATIONS" as const,
      businessStatus: "OPEN" as const,
      orderingEnabled: true,
      isActive: true,
    };

    expect(updateStallSchema.safeParse(basicUpdate).success).toBe(true);
    expect(updateStallSchema.safeParse({ ...basicUpdate, orderingEnabled: false }).success).toBe(false);
    expect(updateStallSchema.safeParse(operationsUpdate).success).toBe(true);
    expect(updateStallSchema.safeParse({ ...operationsUpdate, name: "不可夾帶" }).success).toBe(false);
  });
});
