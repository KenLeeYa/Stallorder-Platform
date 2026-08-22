import { describe, expect, it } from "vitest";
import {
  buildStarWebPrntRequest,
  classifyStarWebPrntResponse,
  detectStarWebPrntEnvironment,
  starWebPrntLaunchUrl,
} from "@/lib/star-webprnt-client";

describe("Star webPRNT Bluetooth client", () => {
  it("distinguishes Star webPRNT Browser from ordinary iPad Safari", () => {
    expect(detectStarWebPrntEnvironment(
      "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) StarWebPRNTBrowser/3.8.0 webPRNTSupportMessageHandler",
    )).toBe("STAR_WEBPRNT");
    expect(detectStarWebPrntEnvironment(
      "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    )).toBe("IOS_SAFARI");
    expect(detectStarWebPrntEnvironment(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    )).toBe("IOS_SAFARI");
    expect(detectStarWebPrntEnvironment(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
    )).toBe("OTHER");
  });

  it("wraps the immutable StarPRNT bytes in a webPRNT raw-data request", () => {
    expect(buildStarWebPrntRequest("G0AxMjM=")).toBe("<rawdata>G0AxMjM=</rawdata>");
  });

  it.each(["", "not base64", "AQ=Z", "<script>"])(
    "rejects malformed printer data before reaching the native bridge: %s",
    (dataBase64) => {
      expect(() => buildStarWebPrntRequest(dataBase64)).toThrow("INVALID_PAYLOAD");
    },
  );

  it("maps printer status to one actionable failure without hiding hard faults", () => {
    expect(classifyStarWebPrntResponse({ traderSuccess: "false" }, {})).toBe("PRINT_REJECTED");
    expect(classifyStarWebPrntResponse(
      { traderSuccess: "true" },
      { paperEnd: true, coverOpen: true },
    )).toBe("PAPER_END");
    expect(classifyStarWebPrntResponse(
      { traderSuccess: "true" },
      { cutterError: true },
    )).toBe("CUTTER_ERROR");
    expect(classifyStarWebPrntResponse({ traderSuccess: "true" }, {})).toBeNull();
  });

  it("builds the official iOS URL scheme without exposing credentials", () => {
    expect(starWebPrntLaunchUrl("https://app.qidaigo.com/staff/demo/print?tab=pending"))
      .toBe("webprnt://starmicronics.com/open?url=https%3A%2F%2Fapp.qidaigo.com%2Fstaff%2Fdemo%2Fprint%3Ftab%3Dpending");
  });
});
