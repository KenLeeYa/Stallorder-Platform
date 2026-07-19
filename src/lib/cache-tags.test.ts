import { describe, expect, it } from "vitest";
import { publicQrCacheTag, stallMenuCacheTag } from "./cache-tags";

describe("public cache tags", () => {
  it("uses one stable tag per stall menu", () => {
    expect(stallMenuCacheTag("stall-id")).toBe("stall-menu:stall-id");
  });

  it("never places a raw QR token in a cache tag", () => {
    const token = "printed-secret-token";
    const tag = publicQrCacheTag(token);

    expect(tag).toMatch(/^public-qr:[a-f0-9]{64}$/);
    expect(tag).not.toContain(token);
  });
});
