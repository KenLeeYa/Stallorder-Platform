import { describe, expect, it, vi } from "vitest";
import { ClientCredentialsTokenService } from "./client-credentials-token-service";

function tokenResponse(token: string, expiresIn = 7_200) {
  return new Response(JSON.stringify({
    access_token: token,
    expires_in: expiresIn,
    token_type: "Bearer",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("client credentials token service", () => {
  it("caches a token and sends the client secret only in the form body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("token-1"));
    const service = new ClientCredentialsTokenService({
      clientId: "client-1",
      resolveClientSecret: () => "secret-1",
      tokenUrl: new URL("https://auth.example.test/oauth/token"),
      refreshSkewSeconds: 60,
      fetchImpl,
      now: () => 1_000,
    });

    await expect(service.getAccessToken()).resolves.toBe("token-1");
    await expect(service.getAccessToken()).resolves.toBe("token-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, request] = fetchImpl.mock.calls[0];
    expect(request?.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(request?.redirect).toBe("manual");
    expect(String(request?.body)).toContain("client_secret=secret-1");
  });

  it("uses one token request for concurrent callers", async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const service = new ClientCredentialsTokenService({
      clientId: "client-1",
      resolveClientSecret: () => "secret-1",
      tokenUrl: new URL("https://auth.example.test/oauth/token"),
      refreshSkewSeconds: 60,
      fetchImpl,
    });

    const first = service.getAccessToken();
    const second = service.getAccessToken();
    release(tokenResponse("token-1"));

    await expect(Promise.all([first, second])).resolves.toEqual(["token-1", "token-1"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes inside the skew window and after explicit invalidation", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("token-1", 120))
      .mockResolvedValueOnce(tokenResponse("token-2", 120))
      .mockResolvedValueOnce(tokenResponse("token-3", 120));
    const service = new ClientCredentialsTokenService({
      clientId: "client-1",
      resolveClientSecret: () => "secret-1",
      tokenUrl: new URL("https://auth.example.test/oauth/token"),
      refreshSkewSeconds: 30,
      fetchImpl,
      now: () => now,
    });

    await expect(service.getAccessToken()).resolves.toBe("token-1");
    now = 91_000;
    await expect(service.getAccessToken()).resolves.toBe("token-2");
    service.invalidate("token-2");
    await expect(service.getAccessToken()).resolves.toBe("token-3");
  });

  it.each([
    [401, "INVALID_CREDENTIALS"],
    [429, "RETRYABLE_PROVIDER_ERROR"],
    [503, "RETRYABLE_PROVIDER_ERROR"],
  ])("maps token HTTP %i to %s", async (status, code) => {
    const service = new ClientCredentialsTokenService({
      clientId: "client-1",
      resolveClientSecret: () => "secret-1",
      tokenUrl: new URL("https://auth.example.test/oauth/token"),
      refreshSkewSeconds: 60,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status })),
    });
    await expect(service.getAccessToken()).rejects.toMatchObject({ code });
  });

  it("rejects malformed success responses without exposing their contents", async () => {
    const service = new ClientCredentialsTokenService({
      clientId: "client-1",
      resolveClientSecret: () => "secret-1",
      tokenUrl: new URL("https://auth.example.test/oauth/token"),
      refreshSkewSeconds: 60,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json")),
    });
    await expect(service.getAccessToken()).rejects.toMatchObject({
      code: "PROVIDER_CONTRACT_ERROR",
      message: "PROVIDER_CONTRACT_ERROR",
    });
  });

  it("rejects redirects without following the client-secret POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 307,
      headers: { location: "https://attacker.test/token" },
    }));
    const service = new ClientCredentialsTokenService({
      clientId: "client-1",
      resolveClientSecret: () => "secret-1",
      tokenUrl: new URL("https://auth.example.test/oauth/token"),
      refreshSkewSeconds: 60,
      fetchImpl,
    });

    await expect(service.getAccessToken()).rejects.toMatchObject({
      code: "PROVIDER_CONTRACT_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("rejects an oversized streamed token response before consuming every chunk", async () => {
    const stream = oversizedStream(20_000, 10);
    const service = new ClientCredentialsTokenService({
      clientId: "client-1",
      resolveClientSecret: () => "secret-1",
      tokenUrl: new URL("https://auth.example.test/oauth/token"),
      refreshSkewSeconds: 60,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream.body)),
    });

    await expect(service.getAccessToken()).rejects.toMatchObject({
      code: "PROVIDER_CONTRACT_ERROR",
    });
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
