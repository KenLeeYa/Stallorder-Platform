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
});
