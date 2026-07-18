import { describe, expect, it } from "vitest";
import { publicMenuCacheTag, publicQrCacheTag } from "./public-menu-cache-tags";

describe("public menu cache tags", () => {
  it("uses the stall id for menu invalidation", () => {
    expect(publicMenuCacheTag("stall-id")).toBe("stall-menu:stall-id");
  });

  it("never places a raw QR token in a cache tag", () => {
    const token = "printed-secret-token";
    const tag = publicQrCacheTag(token);

    expect(tag).toMatch(/^public-qr:[a-f0-9]{64}$/);
    expect(tag).not.toContain(token);
  });
});
