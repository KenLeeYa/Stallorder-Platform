import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLegacySlug: vi.fn(),
}));

vi.mock("@/lib/public-storefront", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/public-storefront")>(),
  resolveLegacyPublicStorefrontSlug: mocks.resolveLegacySlug,
}));

import { GET as getDelivery } from "./route";
import { GET as getMenu } from "../../menu/[stallSlug]/route";
import { GET as getSharedTakeout } from "../../s/[stallSlug]/route";

describe("legacy public storefront redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveLegacySlug.mockResolvedValue({
      canonicalIdentifier: "viet-food-yc",
      matchedBy: "legacy-slug",
      stall: {},
    });
  });

  it.each([
    ["menu", getMenu, "menu"],
    ["shared takeout", getSharedTakeout, "pickup"],
    ["delivery", getDelivery, "delivery"],
  ])("redirects the %s route to its canonical store mode", async (_label, handler, view) => {
    const response = await handler(
      new Request("https://app.qidaigo.com/legacy?locale=vi&utm_source=line&next=https://attacker.example"),
      { params: Promise.resolve({ stallSlug: "a-hong-he-fen" }) },
    );

    expect(mocks.resolveLegacySlug).toHaveBeenCalledWith("a-hong-he-fen");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `/store/viet-food-yc?locale=vi&utm_source=line&view=${view}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("returns not found instead of redirecting an unknown identifier", async () => {
    mocks.resolveLegacySlug.mockResolvedValue(null);

    const response = await getDelivery(
      new Request("https://app.qidaigo.com/delivery/missing"),
      { params: Promise.resolve({ stallSlug: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
