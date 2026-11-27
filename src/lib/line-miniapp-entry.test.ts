import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeMiniAppEntry } from "./line-miniapp-entry";
const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("./line-miniapp-liff", () => ({ initializeMiniApp: init }));
afterEach(() => vi.resetAllMocks());
describe("MINI primary redirect initialization", () => {
  it("does not initialize ordinary MINI page views or act on a similarly named parameter", async () => {
    await initializeMiniAppEntry("123-fixture", "?view=pickup");
    await initializeMiniAppEntry("123-fixture", "?liffState=store");
    expect(init).not.toHaveBeenCalled();
  });
  it("initializes the primary redirect while leaving every incoming query parameter intact", async () => {
    const search="?liff.state=%2Forders%2Fexample%3Fx%3D1&liff.referrer=https%3A%2F%2Fexample.com&view=pickup";
    const location={search};vi.stubGlobal('window',{location});
    await initializeMiniAppEntry("123-fixture",location.search);
    expect(init).toHaveBeenCalledExactlyOnceWith("123-fixture");expect(location.search).toBe(search);
    vi.unstubAllGlobals();
  });
  it("allows a failed initialization to be retried without losing the original deep link", async () => {
    init.mockRejectedValueOnce(new Error("SDK_UNAVAILABLE")).mockResolvedValueOnce(undefined);
    const search="?liff.state=%2Fstore%2Fshop%3Fview%3Dpickup";
    await expect(initializeMiniAppEntry("123-fixture",search)).rejects.toThrow("SDK_UNAVAILABLE");
    await expect(initializeMiniAppEntry("123-fixture",search)).resolves.toBeUndefined();
    expect(init).toHaveBeenCalledTimes(2);
  });
});
