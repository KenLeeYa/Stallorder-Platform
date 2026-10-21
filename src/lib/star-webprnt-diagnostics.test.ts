import { afterEach, expect, it, vi } from "vitest";
import { reportStarWebPrntFailure } from "./star-webprnt-diagnostics";
import { StarWebPrntError } from "./star-webprnt-client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("deduplicates safe client reports and does not send arbitrary exceptions", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const error = new StarWebPrntError("OFFLINE", { traderCode: "1100" });
  reportStarWebPrntFailure("qa", "printer", "PROBE", error);
  reportStarWebPrntFailure("qa", "printer", "PROBE", error);
  reportStarWebPrntFailure("qa", "printer", "PROBE", new Error("customer data"));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    operation: "WEBPRNT_DIAGNOSTIC", printerId: "printer", phase: "PROBE", code: "OFFLINE", traderCode: "1100",
  });
});

it("bounds a stalled diagnostic upload without replaying a command", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  vi.stubGlobal("fetch", fetch);
  reportStarWebPrntFailure("stalled", "printer", "PROBE", new StarWebPrntError("TIMEOUT"));
  await vi.advanceTimersByTimeAsync(5_001);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
