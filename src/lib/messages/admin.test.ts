import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import {
  adminMessages,
  getAdminApiError,
  getAdminCodeLabel,
  getAdminMessage,
} from "@/lib/messages/admin";

describe("admin messages", () => {
  it("provides the same complete catalog for every supported locale", () => {
    const referenceKeys = Object.keys(adminMessages.en).sort();

    for (const locale of APP_LOCALES) {
      expect(Object.keys(adminMessages[locale]).sort()).toEqual(referenceKeys);
      expect(Object.values(adminMessages[locale]).every((message) => message.trim().length > 0)).toBe(true);
    }
  });

  it("interpolates values without translating merchant content", () => {
    expect(getAdminMessage("ja", "Plan: {plan}", { plan: "越好吃一中店" })).toContain("越好吃一中店");
  });

  it("maps stable codes for supported locales", () => {
    expect(getAdminCodeLabel("vi", "ACTIVE")).toBe("Đang hoạt động");
    expect(getAdminCodeLabel("th", "UNKNOWN_CODE")).toBe("UNKNOWN_CODE");
  });

  it("uses localized stable errors and does not expose raw server errors outside zh-TW", () => {
    expect(getAdminApiError("ko", { code: "FORBIDDEN", error: "內部錯誤細節" })).toBe("이 작업을 수행할 권한이 없습니다.");
    expect(getAdminApiError("en", { error: "內部錯誤細節" })).toBe("Operation failed. Try again later.");
    expect(getAdminApiError("zh-TW", { error: "可讀取的錯誤" })).toBe("可讀取的錯誤");
  });
});
