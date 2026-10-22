import { afterEach, describe, expect, it, vi } from "vitest";
import { findOrderClosureNotice } from "@/lib/order-closure-notice";

const harness = vi.hoisted(() => ({
  effect: undefined as undefined | (() => () => void),
  setters: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => () => void) => { harness.effect = effect; },
  useState: <T,>(initial: T) => {
    const setter = vi.fn();
    harness.setters.push(setter);
    return [initial, setter];
  },
}));

import { PublicOrderClosureNotice } from "./public-order-closure-notice";

const closure = { id: "closure", startsOn: "2026-10-22", endsOn: "2026-10-22", title: "Temporary closure", message: "", opensAt: null, closesAt: null };
const pickupAt = "2026-10-22T04:00:00Z";
const oldSnapshot = { timezone: "Asia/Taipei", closures: [closure] };
const newSnapshot = { timezone: "Asia/Taipei", closures: [] };
let stop: (() => void) | undefined;

function mount() {
  const document = new EventTarget();
  Object.assign(document, { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
  PublicOrderClosureNotice({ identifier: "synthetic-store", fulfillmentAt: pickupAt, pendingAt: null, locale: "en" });
  stop = harness.effect!();
  return document;
}

describe("public order closure notice refresh", () => {
  afterEach(() => {
    stop?.();
    stop = undefined;
    harness.effect = undefined;
    harness.setters = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("removes a withdrawn notice when visibility refresh arrives during an older request", async () => {
    let finishOlderRequest!: (response: Response) => void;
    const olderRequest = new Promise<Response>((resolve) => { finishOlderRequest = resolve; });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(oldSnapshot))
      .mockReturnValueOnce(olderRequest)
      .mockResolvedValue(Response.json(newSnapshot));
    vi.stubGlobal("fetch", fetchImpl);
    const document = mount();
    const setData = harness.setters[0];
    await vi.waitFor(() => expect(setData).toHaveBeenCalledWith(oldSnapshot));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The server withdraws the closure while the pre-withdrawal snapshot is in flight.
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    finishOlderRequest(Response.json(oldSnapshot));
    await vi.waitFor(() => {
      const data = setData.mock.lastCall![0] as typeof oldSnapshot;
      expect(findOrderClosureNotice(data.closures, data.timezone, [pickupAt])).toBeNull();
    }, { timeout: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(setData).toHaveBeenLastCalledWith(newSnapshot);
  });

  it("refreshes normally after an idle request without an extra fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json(oldSnapshot))
      .mockResolvedValue(Response.json(newSnapshot));
    vi.stubGlobal("fetch", fetchImpl);
    const document = mount();
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenCalledWith(oldSnapshot));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenLastCalledWith(newSnapshot));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not restart queued work or apply data after unmount", async () => {
    let finish!: (response: Response) => void;
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchImpl);
    const document = mount();
    document.dispatchEvent(new Event("visibilitychange"));
    stop!();
    const response = Response.json(oldSnapshot);
    const readBody = vi.spyOn(response, "json");
    finish(response);
    await vi.waitFor(() => expect(readBody).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(harness.setters[0]).not.toHaveBeenCalled();
    expect(harness.setters[1]).not.toHaveBeenCalled();
  });

  it("defers queued work while hidden and refreshes on return", async () => {
    let finish!: (response: Response) => void;
    const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValue(Response.json(newSnapshot));
    vi.stubGlobal("fetch", fetchImpl);
    const document = mount();
    document.dispatchEvent(new Event("visibilitychange"));
    Object.assign(document, { visibilityState: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    finish(Response.json(oldSnapshot));
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenCalledWith(oldSnapshot));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    Object.assign(document, { visibilityState: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(harness.setters[0]).toHaveBeenLastCalledWith(newSnapshot));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a failed refresh without immediately retrying by itself", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchImpl);
    mount();
    await vi.waitFor(() => expect(harness.setters[1]).toHaveBeenCalledWith(true));
    expect(harness.setters[0]).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
