import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyStaffPushWorker } from "./staff-push-client";

function registration(reply?: object) {
  const close = vi.fn();
  let channel: { port1: { onmessage?: (event: { data: object }) => void } };
  vi.stubGlobal("MessageChannel", class {
    port1 = { close, onmessage: undefined as ((event: { data: object }) => void) | undefined };
    port2 = { close };
    constructor() { channel = { port1: this.port1 }; }
  });
  const postMessage = vi.fn(() => { if (reply) channel.port1.onmessage?.({ data: reply }); });
  return { value: { active: { postMessage } } as unknown as ServiceWorkerRegistration, close, postMessage };
}

describe("active Web Push worker readiness", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("accepts only the running non-silent worker and releases the message ports", async () => {
    const r = registration({ supported: true, silent: false });
    await verifyStaffPushWorker(r.value);
    expect(r.postMessage).toHaveBeenCalledWith({ type: "STAFF_PUSH_CAPABILITY" }, expect.any(Array));
    expect(r.close).toHaveBeenCalledTimes(2);
  });
  it.each([{ supported: true }, { supported: true, silent: true }, { supported: false, silent: false }])("rejects an old or incompatible active worker: %j", async reply => {
    const r = registration(reply);
    await expect(verifyStaffPushWorker(r.value)).rejects.toThrow("通知服務尚未更新");
    expect(r.close).toHaveBeenCalledTimes(2);
  });
  it("does not accept a waiting worker while the active worker is absent", async () => {
    await expect(verifyStaffPushWorker({ active: null } as ServiceWorkerRegistration)).rejects.toThrow("通知服務尚未更新");
  });
  it("bounds a silent worker response without activating an update", async () => {
    vi.useFakeTimers();
    const r = registration();
    const result = expect(verifyStaffPushWorker(r.value)).rejects.toThrow("通知服務尚未更新");
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(r.close).toHaveBeenCalledTimes(2);
    expect(r.postMessage).toHaveBeenCalledTimes(1);
  });
});
