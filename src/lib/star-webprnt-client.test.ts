import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  buildStarWebPrntRequest,
  detectStarWebPrntEnvironment,
  isStarWebPrntSdkReady,
  openStarCashDrawer,
  probeStarWebPrnt,
  classifyStarWebPrntResponse,
  printWithStarWebPrnt,
  StarWebPrntError,
  withStarWebPrntDiagnostics,
} from "./star-webprnt-client";

describe("Star WebPRNT client", () => {
  it("recognizes an SDK that loaded before client-side navigation", () => {
    expect(isStarWebPrntSdkReady({ StarWebPrintTrader: class Trader {} })).toBe(true);
    expect(isStarWebPrntSdkReady({})).toBe(false);
    expect(isStarWebPrntSdkReady(undefined)).toBe(false);
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("settles a missing native callback and does not send or replay another ticket", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    class SilentTrader { sendMessage = send; }
    vi.stubGlobal("window", {
      navigator: { userAgent: "webPRNTSupportMessageHandler iPad" },
      StarWebPrintTrader: SilentTrader,
    });
    let code = "pending";
    const first = printWithStarWebPrnt("G0BA", 25).catch((error) => { code = error.code; });
    await vi.advanceTimersByTimeAsync(26);
    expect(code).toBe("TIMEOUT");
    await first;
    await expect(probeStarWebPrnt()).rejects.toMatchObject({ code: "BRIDGE_UNRESPONSIVE" });
    await expect(printWithStarWebPrnt("G0BA")).rejects.toMatchObject({ code: "BRIDGE_UNRESPONSIVE" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("preserves the hardware reason when Star reports an unsuccessful job", () => {
    expect(classifyStarWebPrntResponse({ traderSuccess: "false" }, { paperEnd: true, offline: true })).toBe("PAPER_END");
    expect(classifyStarWebPrntResponse({ traderSuccess: "false" }, { coverOpen: true, offline: true })).toBe("COVER_OPEN");
  });

  it("distinguishes Star offline and another-device busy codes from generic rejection", () => {
    expect(classifyStarWebPrntResponse({ traderSuccess: "false", traderCode: "1100" }, {})).toBe("OFFLINE");
    expect(classifyStarWebPrntResponse({ traderSuccess: "false", traderCode: "2001" }, {})).toBe("PRINTER_BUSY");
  });

  it("retains only bounded protocol codes, never vendor response text", () => {
    const error = new StarWebPrntError("PRINT_REJECTED", { traderSuccess: false, traderCode: "2001", traderStatus: "0000080000000000", status: 200 });
    expect(withStarWebPrntDiagnostics("Rejected", error)).toBe("Rejected [PRINT_REJECTED; traderCode=2001; traderStatus=0000080000000000; httpStatus=200]");
    expect(new StarWebPrntError("CONNECTION_ERROR", { traderCode: "private token", traderStatus: "private receipt", status: 999 }).diagnostics).toEqual({});
  });

  it("serializes the real vendor's iOS callback slot and recovers only after its late callback", async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const sandbox = {
      navigator: { userAgent: "webPRNTSupportMessageHandler iPad" },
      webkit: { messageHandlers: { sendMessageHandler: { postMessage } } },
      setTimeout, clearTimeout,
    };
    runInNewContext(readFileSync("public/vendor/star-webprnt/StarWebPrintTrader-1.2.0.js", "utf8"), sandbox);
    const native = sandbox as typeof sandbox & { StarWebPrintTrader: Window["StarWebPrintTrader"]; _onFinish: (response: object) => void };
    vi.stubGlobal("window", { navigator: sandbox.navigator, StarWebPrintTrader: native.StarWebPrintTrader });
    const first = printWithStarWebPrnt("G0BA", 25).catch(error => error.code);
    const queued = probeStarWebPrnt(25).catch(error => error.code);
    expect(postMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(26);
    expect(await first).toBe("TIMEOUT");
    expect(await queued).toBe("BRIDGE_UNRESPONSIVE");
    expect(postMessage).toHaveBeenCalledTimes(1);
    const response = {
      url: "http://localhost:8001/StarWebPRNT/SendMessage", htmlCode: 200,
      response: "&lt;success&gt;true&lt;/success&gt;&lt;code&gt;0&lt;/code&gt;&lt;status&gt;0000000000000000&lt;/status&gt;",
    };
    native._onFinish(response);
    const probe = probeStarWebPrnt();
    expect(postMessage).toHaveBeenCalledTimes(2);
    native._onFinish(response);
    await expect(probe).resolves.toMatchObject({ traderSuccess: "true" });
    expect(postMessage.mock.calls[1][0]).not.toContain("rawdata");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["0000000000080000", "PAPER_END"], ["0000200000000000", "COVER_OPEN"],
    ["0000080000000000", "OFFLINE"], ["0000000800000000", "CUTTER_ERROR"],
  ])("decodes actual vendor status bits %s on unsuccessful jobs as %s", async (status, code) => {
    const sandbox = {
      navigator: { userAgent: "webPRNTSupportMessageHandler iPad" },
      webkit: { messageHandlers: { sendMessageHandler: { postMessage: () => finish?.({
        url: "http://localhost:8001/StarWebPRNT/SendMessage", htmlCode: 200,
        response: `&lt;success&gt;false&lt;/success&gt;&lt;code&gt;1100&lt;/code&gt;&lt;status&gt;${status}&lt;/status&gt;`,
      }) } } }, setTimeout, clearTimeout,
    };
    runInNewContext(readFileSync("public/vendor/star-webprnt/StarWebPrintTrader-1.2.0.js", "utf8"), sandbox);
    const native = sandbox as typeof sandbox & { StarWebPrintTrader: Window["StarWebPrintTrader"]; _onFinish: (response: object) => void };
    const finish = native._onFinish;
    vi.stubGlobal("window", { navigator: sandbox.navigator, StarWebPrintTrader: native.StarWebPrintTrader });
    await expect(probeStarWebPrnt()).rejects.toMatchObject({ code, diagnostics: { traderCode: "1100", traderStatus: status, httpStatus: 200 } });
  });

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
