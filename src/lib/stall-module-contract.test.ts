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
      preorderSlotMinutes: "預約時段間隔只能選擇 15、30、60 或 120 分鐘。",
      lotteryDiscountWinRateBps: "折扣中獎率不可小於 0%。",
    });
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
    })).toEqual({
      takeoutPreorderEnabled: false,
      preorderMinLeadMinutes: 15,
      preorderMaxDays: 1,
      preorderSlotMinutes: 30,
      lotteryEnabled: false,
      lotteryDiscountOptionId: null,
      lotteryDiscountWinRateBps: 0,
    });
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
});
