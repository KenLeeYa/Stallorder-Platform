import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const shown = new Set<string>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockResolvedValue({ status: 204 });
  const openWindow = vi.fn();
  const focus = vi.fn();
  const context = {
    URL, Map, Set, Date, console, fetch,
    self: { location: { hostname: "qa.example.test", href: "https://qa.example.test/sw.js", origin: "https://qa.example.test" },
      addEventListener: (type: string, listener: typeof listeners[string]) => { listeners[type] = listener; },
      registration: { showNotification }, clients: { matchAll: vi.fn().mockResolvedValue([{ url: "https://qa.example.test/staff/qa", focus }]), openWindow } },
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), context);
  // Storage is covered by browser persistence; these substitutes isolate the push/click contract.
  Object.assign(context, { pushWasShown: async (tag: string) => shown.has(tag), rememberPush: async (tag: string) => { shown.add(tag); } });
  const payload = { type: "STAFF_NEW_ORDER", deliveryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "新訂單", body: "請查看看板", tag: "staff-order-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    url: "/staff/qa", receiptToken: "signed-receipt" };
  async function push(value: unknown = payload) {
    let work = Promise.resolve();
    listeners.push({ data: { json: () => value }, waitUntil: (promise: Promise<void>) => { work = promise; } });
    await work;
  }
  return { push, payload, listeners, showNotification, fetch, openWindow, focus };
}
describe("Web Push service worker", () => {
  it("shows notification and only then sends a display receipt; retry does not duplicate", async () => {
    const w = worker();
    await w.push(); await w.push();
    expect(w.showNotification).toHaveBeenCalledTimes(1);
    expect(w.showNotification.mock.calls[0][1]).toMatchObject({ silent: false, renotify: false, data: { url: "/staff/qa" } });
    expect(w.fetch).toHaveBeenCalledWith("/api/push/receipt", expect.anything());
    expect(w.showNotification.mock.invocationCallOrder[0]).toBeLessThan(w.fetch.mock.invocationCallOrder[0]);
  });
  it("requests sound for each distinct new order without re-alerting retries", async () => {
    const w = worker();
    await w.push();
    await w.push({ ...w.payload, tag: "staff-order-cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    await w.push();
    expect(w.showNotification).toHaveBeenCalledTimes(2);
    for (const [, options] of w.showNotification.mock.calls) expect(options.silent).toBe(false);
  });
  it("reports the active notification sound policy to the test controls", () => {
    const w = worker();
    const postMessage = vi.fn();
    w.listeners.message({ data: { type: "STAFF_PUSH_CAPABILITY" }, ports: [{ postMessage }] });
    expect(postMessage).toHaveBeenCalledWith({ supported: true, silent: false });
  });
  it("ignores invalid payloads and external notification targets", async () => {
    const w = worker();
    await w.push({ ...w.payload, url: "//evil.example/staff/qa" });
    await w.push({ ...w.payload, type: "ORDER_COMPLETED" });
    expect(w.showNotification).not.toHaveBeenCalled();
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it("does not acknowledge a display that failed", async () => {
    const w = worker(); w.showNotification.mockRejectedValue(new Error("OS_DENIED"));
    await expect(w.push()).rejects.toThrow("OS_DENIED");
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it("focuses only the matching staff page on click", async () => {
    const w = worker();
    let work = Promise.resolve();
    w.listeners.notificationclick({ notification: { close: vi.fn(), data: { url: "/staff/qa" } }, waitUntil: (promise: Promise<void>) => { work = promise; } });
    await work;
    expect(w.focus).toHaveBeenCalledTimes(1);
    expect(w.openWindow).not.toHaveBeenCalled();
  });
});
