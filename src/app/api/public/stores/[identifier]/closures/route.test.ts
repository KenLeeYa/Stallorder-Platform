import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/public-storefront", () => ({ resolvePublicStorefront: mocks.resolve }));
vi.mock("@/lib/prisma", () => ({ prisma: { stallSpecialClosure: { findMany: mocks.find } } }));
import { GET } from "./route";

describe("public closure announcements", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  const request = () => GET(new Request("http://localhost/api/public/stores/store-code/closures"), { params: Promise.resolve({ identifier: "store-code" }) });
  it("returns only public closure fields for the resolved store", async () => {
    mocks.resolve.mockResolvedValue({ stall: { id: "resolved-store", timezone: "Asia/Taipei", qrCodes: [{ token: "private-qr-token" }] } });
    mocks.find.mockResolvedValue([{ id: "closure", startsOn: new Date("2026-09-07"), endsOn: new Date("2026-09-08"), opensAt: null, closesAt: null, title: "店休", message: "公告" }]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ stallId: "resolved-store" }) }));
    const body = await response.json();
    expect(body).toEqual({ timezone: "Asia/Taipei", closures: [{ id: "closure", startsOn: "2026-09-07", endsOn: "2026-09-08", opensAt: null, closesAt: null, title: "店休", message: "公告" }] });
    expect(JSON.stringify(body)).not.toContain("private-qr-token");
  });
  it("does not query announcements for a hidden or unknown store", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("returns a stable unavailable response without exposing database errors", async () => {
    mocks.resolve.mockRejectedValue(new Error("private connection details"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "STORE_CLOSURES_UNAVAILABLE" });
  });
});
