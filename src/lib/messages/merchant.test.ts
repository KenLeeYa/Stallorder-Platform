import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import {
  getMerchantMessage,
  merchantMessages,
} from "@/lib/messages/merchant";

describe("merchant message catalog", () => {
  it("keeps every application locale on the same merchant key contract", () => {
    const keys = Object.keys(merchantMessages["zh-TW"]).sort();
    for (const locale of APP_LOCALES) {
      expect(Object.keys(merchantMessages[locale]).sort()).toEqual(keys);
    }
  });

  it("returns the selected locale without translating merchant-supplied values", () => {
    expect(getMerchantMessage("vi", "管理攤位")).toBe("Quản lý quầy");
  });

  it("localizes shared-catalog counts and assignment labels", () => {
    expect(getMerchantMessage("en", "商品目錄（{value0}）", { value0: 4 })).toBe("Product catalog (4)");
    expect(getMerchantMessage("en", "已分派")).toBe("Assigned to");
  });

  it("uses short merchant-facing help text", () => {
    expect(getMerchantMessage("zh-TW", "依登入者權限、攤位與篩選條件，由伺服器分頁載入資料。"))
      .toBe("依攤位與條件查看警示和操作紀錄。");
    expect(getMerchantMessage("zh-TW", "用量以完成且首次計費的訂單為準；取消、拒絕與逾時訂單不會計入。"))
      .toBe("只計算完成的訂單；取消、拒絕或逾時不計入。");
  });
});
