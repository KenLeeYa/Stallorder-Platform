import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const mocks = vi.hoisted(() => ({ authorizeDr: vi.fn() }));
vi.mock("@/lib/cloudflare-access", () => ({ authorizeDrAccessRequest: mocks.authorizeDr }));

beforeEach(() => {
  mocks.authorizeDr.mockResolvedValue(true);
});

describe("administrator login return path", () => {
  it.each([
    ["/admin/health", "/admin/health"],
    ["/admin/health?next=https://example.com", "/admin/health"],
    ["/admin/billing", "/admin/billing"],
    ["/admin", "/admin/billing"],
  ])("uses the server path for %s and overwrites supplied headers", async (path, expected) => {
    const response = await proxy(new NextRequest(`https://app.example.test${path}`, {
      headers: { "x-stallorder-admin-return-path": "https://example.com" },
    }));
    expect(response.headers.get("x-middleware-request-x-stallorder-admin-return-path")).toBe(expected);
  });

  it("still rejects unauthorized DR requests before forwarding admin headers", async () => {
    mocks.authorizeDr.mockResolvedValue(false);
    const response = await proxy(new NextRequest("https://dr.example.test/admin/health"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("x-middleware-request-x-stallorder-admin-return-path")).toBe(false);
  });

  it("keeps merchant scope headers intact", async () => {
    const response = await proxy(new NextRequest("https://app.example.test/merchant/catalog?organizationId=demo"));
    expect(response.headers.get("x-middleware-request-x-stallorder-route-pathname")).toBe("/merchant/catalog");
  });
});
