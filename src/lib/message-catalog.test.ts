import { describe, expect, it } from "vitest";
import {
  createMessageCatalog,
  interpolateMessage,
} from "@/lib/message-catalog";

describe("message catalog", () => {
  const catalog = createMessageCatalog(
    { greeting: "你好，{name}" },
    {
      en: { greeting: "Hello, {name}" },
      ja: { greeting: "こんにちは、{name}" },
      ko: { greeting: "안녕하세요, {name}" },
      vi: { greeting: "Xin chào, {name}" },
      th: { greeting: "สวัสดี {name}" },
    },
  );

  it("requires and exposes every canonical application locale", () => {
    expect(Object.keys(catalog.messages)).toEqual(["zh-TW", "en", "ja", "ko", "vi", "th"]);
    expect(catalog.get("vi", "greeting", { name: "An" })).toBe("Xin chào, An");
  });

  it("leaves unknown placeholders visible instead of silently removing them", () => {
    expect(interpolateMessage("{known} {missing}", { known: 3 })).toBe("3 {missing}");
  });
});
