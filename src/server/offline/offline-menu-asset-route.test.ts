import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/assets/offline-menus/[...objectPath]/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const objectName = `1-${"a".repeat(64)}.json`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("offline menu asset route", () => {
  it("rejects malformed and traversal paths before any storage request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://app.example.com/api/assets/offline-menus/../secret.json"),
      { params: Promise.resolve({ objectPath: ["..", "secret.json"] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves an immutable JSON snapshot from the standby origin after primary failure", async () => {
    vi.stubEnv("PRIMARY_SUPABASE_URL", "https://primary.example.com");
    vi.stubEnv("DR_SUPABASE_URL", "https://standby.example.com");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce(new Response('{"schemaVersion":1}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://app.example.com/api/assets/offline-menus/snapshot"),
      {
        params: Promise.resolve({
          objectPath: [organizationId, stallId, objectName],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ schemaVersion: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("standby.example.com");
  });
});
