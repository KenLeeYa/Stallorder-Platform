import { afterEach, describe, expect, it, vi } from "vitest";

describe("publicEdgeUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("設定正式 Edge Function 時直接呼叫並附上 publishable key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "https://project.supabase.co/functions/v1/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const { publicEdgeHeaders, publicEdgeUrl } = await import("./public-order-client");

    expect(publicEdgeUrl("create-order-session")).toBe("https://project.supabase.co/functions/v1/create-order-session");
    expect(publicEdgeHeaders()).toEqual({
      apikey: "public-test-key",
      authorization: "Bearer public-test-key",
    });
  });

  it("缺少直接呼叫設定時使用同站 API proxy", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { publicEdgeHeaders, publicEdgeUrl } = await import("./public-order-client");

    expect(publicEdgeUrl("create-order-session")).toBe("/api/public-order/create-order-session");
    expect(publicEdgeHeaders()).toEqual({});
  });

  it("Vercel Preview 使用同站 API proxy，避免每個預覽網域都要修改 Edge CORS", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "https://project.supabase.co/functions/v1/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubGlobal("window", { location: { hostname: "project-preview.vercel.app" } });
    const { publicEdgeHeaders, publicEdgeUrl } = await import("./public-order-client");

    expect(publicEdgeUrl("create-order-session")).toBe("/api/public-order/create-order-session");
    expect(publicEdgeHeaders()).toEqual({});
  });
});
