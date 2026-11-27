import { describe, expect, it } from "vitest";
import { buildMiniAppPublicLink, safeMiniAppReturnPath } from "./line-miniapp-links";

describe("MINI App public links", () => {
  it("uses endpoint-relative path and only the explicit public menu parameters", () => {
    expect(buildMiniAppPublicLink({ liffId: "54321-abcde", endpointUrl: "https://qa.example.test/mini", pageUrl: "https://qa.example.test/mini/store/aming?view=menu&locale=zh-TW" }))
      .toBe("https://miniapp.line.me/54321-abcde/store/aming?view=menu&locale=zh-TW");
  });
  it.each(["https://evil.example/mini/store/aming", "https://qa.example.test/mini-other/store/aming", "https://qa.example.test/mini/orders/123", "https://qa.example.test/mini/store/aming?trackingToken=secret", "https://qa.example.test/mini/store/aming?view=delivery&editOrder=secret"])("rejects private or out-of-endpoint page %s", (pageUrl) => {
    expect(() => buildMiniAppPublicLink({ liffId: "54321-abcde", endpointUrl: "https://qa.example.test/mini", pageUrl })).toThrow();
  });
  it.each(["//evil.example", "/%2f%2fevil.example", "/%252f%252fevil.example", "/mini/../admin", "/mini/store/a?token=secret", "/mini\\evil"])("rejects unsafe return %s", (value) => {
    expect(safeMiniAppReturnPath(value)).toBe("/mini");
  });
  it("allows a controlled relative store route", () => {
    expect(safeMiniAppReturnPath("/mini/store/aming?view=pickup")).toBe("/mini/store/aming?view=pickup");
  });
});
