import { describe, expect, it } from "vitest";
import {
  getModuleDuplicateCodeFieldErrors,
  getStallModuleFieldErrors,
  getStallModuleFieldLabel,
  normalizeDisabledModuleSettings,
  stallModuleCommandSchema,
} from "@/lib/stall-module-contract";

describe("stall module field validation", () => {
  it("returns a specific payment-code error when the user enters Chinese", () => {
    const result = stallModuleCommandSchema.safeParse({
      operation: "CREATE_PAYMENT_OPTION",
      code: "現金支付",
      name: "現金支付",
      kind: "CUSTOM",
      isEnabled: true,
      sortOrder: 1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(getStallModuleFieldErrors(result.error)).toEqual({
      code: "付款方式代碼僅可使用英文字母、數字、底線或連字號，不能輸入中文。",
    });
    expect(getStallModuleFieldLabel("code", "CREATE_PAYMENT_OPTION")).toBe("付款方式代碼");
  });

  it("keeps every invalid preorder and lottery field instead of one generic error", () => {
    const result = stallModuleCommandSchema.safeParse({
      operation: "UPDATE_MODULES",
      dineInEnabled: true,
      deliveryModuleEnabled: true,
      staffDeliveryEnabled: true,
      printModuleEnabled: true,
      paymentModuleEnabled: true,
      discountModuleEnabled: true,
      discountApprovalThresholdBps: 10_001,
      takeoutPreorderEnabled: true,
      preorderMinLeadMinutes: 14,
      preorderMaxDays: 31,
      preorderSlotMinutes: 45,
      lotteryEnabled: true,
      lotteryDiscountOptionId: null,
      lotteryDiscountWinRateBps: -1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(getStallModuleFieldErrors(result.error)).toEqual({
      discountApprovalThresholdBps: "經理核准門檻不可超過 100%。",
      preorderMinLeadMinutes: "最少提前時間不可少於 15 分鐘。",
      preorderMaxDays: "最多預約天數不可超過 30 天。",
      preorderSlotMinutes: "預約時段間隔只能選擇 5、15、30、60 或 120 分鐘。",
      lotteryDiscountWinRateBps: "折扣中獎率不可小於 0%。",
    });
  });

  it("accepts an opt-in five-minute preorder interval", () => {
    expect(stallModuleCommandSchema.safeParse({
      ...validModuleCommand(),
      preorderSlotMinutes: 5,
    }).success).toBe(true);
  });

  it("accepts existing supported payment-code separators", () => {
    expect(stallModuleCommandSchema.safeParse({
      operation: "CREATE_PAYMENT_OPTION",
      code: "LINE-PAY_2",
      name: "LINE Pay 2",
      kind: "LINE_PAY",
      isEnabled: true,
      sortOrder: 2,
    }).success).toBe(true);
  });

  it("normalizes hidden preorder and lottery values before saving disabled modules", () => {
    expect(normalizeDisabledModuleSettings({
      takeoutPreorderEnabled: false,
      preorderMinLeadMinutes: 0,
      preorderMaxDays: 0,
      preorderSlotMinutes: 15,
      lotteryEnabled: false,
      lotteryDiscountOptionId: "not-a-uuid",
      lotteryDiscountWinRateBps: -1,
      lotteryDiscountChances: [{
        discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        winRateBps: 5000,
      }],
    })).toEqual({
      takeoutPreorderEnabled: false,
      preorderMinLeadMinutes: 15,
      preorderMaxDays: 1,
      preorderSlotMinutes: 5,
      lotteryEnabled: false,
      lotteryDiscountOptionId: null,
      lotteryDiscountWinRateBps: 0,
      lotteryDiscountChances: [],
    });
  });

  it("accepts multiple lottery discounts while reserving the remaining probability for no prize", () => {
    const result = stallModuleCommandSchema.safeParse({
      ...validModuleCommand(),
      lotteryEnabled: true,
      lotteryDiscountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      lotteryDiscountWinRateBps: 1000,
      lotteryDiscountChances: [
        { discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", winRateBps: 1000 },
        { discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", winRateBps: 2500 },
        { discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", winRateBps: 5000 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate lottery discounts and a combined chance above 100 percent", () => {
    const duplicate = stallModuleCommandSchema.safeParse({
      ...validModuleCommand(),
      lotteryDiscountChances: [
        { discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", winRateBps: 1000 },
        { discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", winRateBps: 2000 },
      ],
    });
    const overLimit = stallModuleCommandSchema.safeParse({
      ...validModuleCommand(),
      lotteryDiscountChances: [
        { discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", winRateBps: 5001 },
        { discountOptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", winRateBps: 5000 },
      ],
    });

    expect(duplicate.success).toBe(false);
    expect(overLimit.success).toBe(false);
    if (!duplicate.success) {
      expect(getStallModuleFieldErrors(duplicate.error)).toEqual({
        lotteryDiscountChances: "同一個折扣不可重複加入抽抽樂。",
      });
    }
    if (!overLimit.success) {
      expect(getStallModuleFieldErrors(overLimit.error)).toEqual({
        lotteryDiscountChances: "所有折扣的中獎率合計不可超過 100%。",
      });
    }
  });

  it("only maps the exact table or payment unique target to the code field", () => {
    expect(getModuleDuplicateCodeFieldErrors("CREATE_PAYMENT_OPTION", ["stall_id", "code"])).toEqual({
      code: "此付款方式代碼已被使用，請改用其他代碼。",
    });
    expect(getModuleDuplicateCodeFieldErrors("UPDATE_TABLE", "dining_tables_stall_code_key")).toEqual({
      code: "此桌位代碼已被使用，請改用其他代碼。",
    });
    expect(getModuleDuplicateCodeFieldErrors("CREATE_PAYMENT_OPTION", "qr_codes_token_key")).toBeUndefined();
    expect(getModuleDuplicateCodeFieldErrors("CREATE_TABLE", ["organization_id", "code"])).toBeUndefined();
  });

  it("validates floor assignment, six shapes, and 15-degree table rotation", () => {
    const valid = stallModuleCommandSchema.safeParse({
      operation: "CREATE_TABLE",
      floorId: null,
      code: "A1",
      label: "A1 桌",
      isActive: true,
      sortOrder: 1,
      shape: "DIAMOND",
      rotationDegrees: 45,
    });
    expect(valid.success).toBe(true);

    const invalid = stallModuleCommandSchema.safeParse({
      operation: "CREATE_TABLE",
      floorId: null,
      code: "A1",
      label: "A1 桌",
      isActive: true,
      sortOrder: 1,
      shape: "TRIANGLE",
      rotationDegrees: 14,
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(getStallModuleFieldErrors(invalid.error)).toEqual({
      rotationDegrees: "旋轉角度必須是 15 度的倍數。",
    });
  });

  it("maps an exact floor-name unique target to the floor name field", () => {
    expect(getModuleDuplicateCodeFieldErrors("CREATE_FLOOR", ["stall_id", "name"])).toEqual({
      name: "此樓層名稱已被使用，請改用其他名稱。",
    });
    expect(getStallModuleFieldLabel("name", "UPDATE_FLOOR")).toBe("樓層名稱");
  });
});

function validModuleCommand() {
  return {
    operation: "UPDATE_MODULES" as const,
    dineInEnabled: true,
    deliveryModuleEnabled: true,
    staffDeliveryEnabled: true,
    printModuleEnabled: true,
    paymentModuleEnabled: true,
    discountModuleEnabled: true,
    discountApprovalThresholdBps: 8000,
    takeoutPreorderEnabled: true,
    preorderMinLeadMinutes: 30,
    preorderMaxDays: 7,
    preorderSlotMinutes: 5 as const,
    lotteryEnabled: true,
    lotteryDiscountOptionId: null,
    lotteryDiscountWinRateBps: 0,
  };
}
