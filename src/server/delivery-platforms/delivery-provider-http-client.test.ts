import { describe, expect, it, vi } from "vitest";
import { DeliveryProviderHttpClient } from "./delivery-provider-http-client";

function tokenProvider() {
  return {
    getAccessToken: vi.fn().mockResolvedValueOnce("expired-token").mockResolvedValue("fresh-token"),
    invalidate: vi.fn(),
  };
}

describe("delivery provider HTTP client", () => {
  it("refreshes once after 401 and never exposes the token in the URL", async () => {
    const tokens = tokenProvider();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "order-1" }), { status: 200 }));
    const client = new DeliveryProviderHttpClient({
      baseUrl: new URL("https://api.example.test"),
      tokenProvider: tokens,
      fetchImpl,
    });

    await expect(client.requestJson({ method: "GET", path: "/orders/order-1" }))
      .resolves.toEqual({ id: "order-1" });
    expect(tokens.invalidate).toHaveBeenCalledWith("expired-token");
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.example.test/orders/order-1");
    expect(fetchImpl.mock.calls[1][1]?.headers).toMatchObject({
      authorization: "Bearer fresh-token",
    });
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it.each([
    [403, "PERMISSION_DENIED"],
    [404, "PROVIDER_RESOURCE_NOT_FOUND"],
    [409, "CONNECTION_STATE_CONFLICT"],
    [422, "UNSUPPORTED_MAPPING"],
    [429, "RETRYABLE_PROVIDER_ERROR"],
    [503, "RETRYABLE_PROVIDER_ERROR"],
  ])("maps provider HTTP %i to %s", async (status, code) => {
    const client = new DeliveryProviderHttpClient({
      baseUrl: new URL("https://api.example.test"),
      tokenProvider: tokenProvider(),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status })),
    });
    await expect(client.requestJson({ method: "GET", path: "/orders/order-1" }))
      .rejects.toMatchObject({ code });
  });

  it("rejects an origin-changing path before a network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new DeliveryProviderHttpClient({
      baseUrl: new URL("https://api.example.test"),
      tokenProvider: tokenProvider(),
      fetchImpl,
    });
    await expect(client.requestJson({ method: "GET", path: "//attacker.test/orders" }))
      .rejects.toMatchObject({ code: "PROVIDER_CONTRACT_ERROR" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects without following a provider mutation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 307,
      headers: { location: "https://attacker.test/orders" },
    }));
    const client = new DeliveryProviderHttpClient({
      baseUrl: new URL("https://api.example.test"),
      tokenProvider: tokenProvider(),
      fetchImpl,
    });

    await expect(client.requestJson({
      method: "PUT",
      path: "/orders/order-1",
      body: { status: "READY" },
    })).rejects.toMatchObject({ code: "PROVIDER_CONTRACT_ERROR" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("rejects an oversized streamed response before consuming every chunk", async () => {
    const stream = oversizedStream(600_000, 10);
    const client = new DeliveryProviderHttpClient({
      baseUrl: new URL("https://api.example.test"),
      tokenProvider: tokenProvider(),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream.body)),
    });

    await expect(client.requestJson({ method: "GET", path: "/orders/order-1" }))
      .rejects.toMatchObject({ code: "PROVIDER_CONTRACT_ERROR" });
    expect(stream.cancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(10);
  });
});

function oversizedStream(chunkBytes: number, chunkCount: number) {
  let pullCount = 0;
  let wasCancelled = false;
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount >= chunkCount) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkBytes).fill(65));
        pullCount += 1;
      },
      cancel() {
        wasCancelled = true;
      },
    }),
    cancelled: () => wasCancelled,
    pulls: () => pullCount,
  };
}
