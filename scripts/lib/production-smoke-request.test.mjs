import { describe, expect, it, vi } from "vitest";

import { fetchWithTransientRetry } from "./production-smoke-request.mjs";

describe("Production smoke request retry", () => {
  it("returns the first successful response without retrying", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const sleep = vi.fn();

    await expect(fetchWithTransientRetry({
      label: "Health endpoint",
      url: "https://app.qidaigo.com/api/health",
      fetchImpl,
      sleep,
    })).resolves.toBe(response);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries one transient fetch failure with a fresh abort signal", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(response);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await expect(fetchWithTransientRetry({
      label: "Dedicated test QR page",
      url: "https://app.qidaigo.com/q/secret-token-must-not-be-logged",
      fetchImpl,
      sleep,
      log,
      retryDelayMs: 25,
    })).resolves.toBe(response);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].signal).not.toBe(fetchImpl.mock.calls[1][1].signal);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(log).toHaveBeenCalledWith(
      "RETRY: Dedicated test QR page - transient TimeoutError (attempt 1/2)",
    );
  });

  it("fails with the request label after the bounded retry and hides the URL", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    const log = vi.fn();

    await expect(fetchWithTransientRetry({
      label: "Dedicated test QR session",
      url: "https://app.qidaigo.com/q/secret-token-must-not-be-logged",
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      log,
    })).rejects.toThrow(
      'Smoke request "Dedicated test QR session" failed after 2 attempts (TypeError).',
    );

    try {
      await fetchWithTransientRetry({
        label: "Dedicated test QR session",
        url: "https://app.qidaigo.com/q/secret-token-must-not-be-logged",
        fetchImpl,
        sleep: vi.fn().mockResolvedValue(undefined),
        log,
      });
    } catch (error) {
      expect(String(error)).not.toContain("secret-token-must-not-be-logged");
    }
  });
});
