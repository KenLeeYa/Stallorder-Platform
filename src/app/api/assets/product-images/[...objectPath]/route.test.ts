import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ manifestFindUnique: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { storageObjectManifest: { findUnique: mocks.manifestFindUnique } },
}));

const objectPath = [
  "11111111-1111-4111-8111-111111111111",
  "stall-banners",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333.webp",
];

describe("product image asset proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://primary.example.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "primary-service-secret");
    vi.stubEnv("DR_SUPABASE_URL", "https://dr.example.test");
    vi.stubEnv("DR_SUPABASE_SECRET_KEY", "dr-service-secret");
  });

  it("fails closed without fetching storage when a deletion tombstone exists", async () => {
    mocks.manifestFindUnique.mockResolvedValue({ deletedAt: new Date() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const route = await import("./route");

    const response = await route.GET(new Request("https://app.example.test/image"), {
      params: Promise.resolve({ objectPath }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a live image with a short revalidation cache", async () => {
    mocks.manifestFindUnique.mockResolvedValue({ deletedAt: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/webp" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const route = await import("./route");

    const response = await route.GET(new Request("https://app.example.test/image"), {
      params: Promise.resolve({ objectPath }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: expect.stringContaining("/storage/v1/object/authenticated/product-images/"),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: "primary-service-secret",
          authorization: "Bearer primary-service-secret",
        }),
      }),
    );
  });

  it("fails closed when no private storage credential is configured", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("DR_SUPABASE_SECRET_KEY", "");
    mocks.manifestFindUnique.mockResolvedValue({ deletedAt: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const route = await import("./route");

    const response = await route.GET(new Request("https://app.example.test/image"), {
      params: Promise.resolve({ objectPath }),
    });

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
