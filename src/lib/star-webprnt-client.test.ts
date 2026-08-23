import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStarWebPrntRequest,
  detectStarWebPrntEnvironment,
  openStarCashDrawer,
  probeStarWebPrnt,
} from "./star-webprnt-client";

describe("Star WebPRNT client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("distinguishes Star WebPRNT Browser from iPad Safari", () => {
    expect(detectStarWebPrntEnvironment("StarWebPRNTBrowser/3.0 iPad")).toBe("STAR_WEBPRNT");
    expect(detectStarWebPrntEnvironment("Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit Mobile/15E148 Safari/604.1")).toBe("IOS_SAFARI");
  });

  it("rejects malformed or oversized raw payloads", () => {
    expect(() => buildStarWebPrntRequest("not base64")).toThrowError("INVALID_PAYLOAD");
    expect(() => buildStarWebPrntRequest(Buffer.alloc(64 * 1024 + 1).toString("base64"))).toThrowError("INVALID_PAYLOAD");
  });

  it("uses a non-printing probe and the MCP31LB drawer channel command", async () => {
    const requests: string[] = [];
    class Trader {
      onReceive: ((response: { traderSuccess: string; traderStatus: string }) => void) | null = null;
      onError = null;
      onTimeout = null;
      constructor() {}
      sendMessage(input: { request: string }) {
        requests.push(input.request);
        this.onReceive?.({ traderSuccess: "true", traderStatus: "0000000000000000" });
      }
      isPaperEnd() { return false; }
      isCoverOpen() { return false; }
      isOffLine() { return false; }
      isAutoCutterError() { return false; }
      isRollPositionError() { return false; }
      isHighTemperatureStop() { return false; }
      isNonRecoverableError() { return false; }
    }
    vi.stubGlobal("window", {
      navigator: { userAgent: "StarWebPRNTBrowser/3.0 iPad" },
      StarWebPrintTrader: Trader,
    });

    await probeStarWebPrnt();
    await openStarCashDrawer();

    expect(requests).toEqual([
      '<text encoding="utf-8"></text>',
      '<peripheral channel="1" on="200" off="200"></peripheral>',
    ]);
  });
});
