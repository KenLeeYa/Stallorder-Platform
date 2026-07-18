import { describe, expect, it } from "vitest";
import { redactPerformanceUrl } from "./performance-url-redaction";

describe("performance URL redaction", () => {
  it.each([
    ["https://app.example/q/printed-token?language=zh", "https://app.example/q/:qrToken"],
    ["https://app.example/order/tracking-token", "https://app.example/order/:trackingToken"],
    ["https://app.example/invite/invitation-token#details", "https://app.example/invite/:invitationToken"],
  ])("redacts capability URLs", (input, expected) => {
    expect(redactPerformanceUrl(input)).toBe(expected);
  });

  it("removes identifiers in query parameters", () => {
    expect(redactPerformanceUrl("https://app.example/merchant/dashboard?organizationId=secret"))
      .toBe("https://app.example/merchant/dashboard");
  });
});
