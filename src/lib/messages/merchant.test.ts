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
});
