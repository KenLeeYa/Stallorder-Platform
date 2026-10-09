import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("canonical public-order device validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authorizes recovery only when the canonical Edge response contains an order", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "https://project.supabase.co/functions/v1/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubEnv("PUBLIC_ORDER_FUNCTION_ORIGIN", "https://app.qidaigo.com/path");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ order: { orderNo: "A001" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const { validateTrackedPublicOrderAtCanonicalEdge } = await import(
      "./canonical-tracking-validator"
    );

    await expect(validateTrackedPublicOrderAtCanonicalEdge({
      trackingToken: "tracking-token",
      deviceId: "device-id",
      clientIp: "203.0.113.8",
      operationId: "11111111-1111-4111-8111-111111111111",
      fetchImpl,
    })).resolves.toEqual({ outcome: "AUTHORIZED" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://project.supabase.co/functions/v1/get-public-order",
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: "public-test-key",
          authorization: "Bearer public-test-key",
          origin: "https://app.qidaigo.com",
          "x-real-ip": "203.0.113.8",
          "x-stallorder-operation-id": "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
  });

  it("uses the actual Preview origin instead of an inherited local app URL", async () => {
    vi.stubEnv("PUBLIC_ORDER_FUNCTION_ORIGIN", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "owned-preview.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const { validateTrackedPublicOrderAtCanonicalEdge } = await import("./canonical-tracking-validator");
    await validateTrackedPublicOrderAtCanonicalEdge({ trackingToken: "tracking-token", deviceId: "device-id",
      clientIp: "203.0.113.8", operationId: "operation-id", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ origin: "https://owned-preview.vercel.app" }),
    }));
  });

  it.each([
    ["preview", "https://explicit.example.test", "https://explicit.example.test"],
    ["production", "", "https://app.qidaigo.com"],
  ])("preserves configured origin precedence in %s", async (environment, explicit, expected) => {
    vi.stubEnv("PUBLIC_ORDER_FUNCTION_ORIGIN", explicit);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.qidaigo.com");
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("VERCEL_URL", "owned-preview.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const { validateTrackedPublicOrderAtCanonicalEdge } = await import("./canonical-tracking-validator");
    await validateTrackedPublicOrderAtCanonicalEdge({ trackingToken: "tracking-token", deviceId: "device-id",
      clientIp: "203.0.113.8", operationId: "operation-id", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ origin: expected }),
    }));
  });

  it.each([
    [404, "NOT_FOUND"],
    [429, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ] as const)("maps status %s to %s", async (status, outcome) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "https://project.supabase.co/functions/v1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const { validateTrackedPublicOrderAtCanonicalEdge } = await import(
      "./canonical-tracking-validator"
    );

    await expect(validateTrackedPublicOrderAtCanonicalEdge({
      trackingToken: "tracking-token",
      deviceId: "device-id",
      clientIp: "203.0.113.8",
      operationId: "operation-id",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
    })).resolves.toEqual({ outcome });
  });
});
