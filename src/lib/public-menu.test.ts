import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMenuProduct } from "./public-menu-types";

const revalidateTag = vi.fn();
const findMany = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidateTag,
  unstable_cache: (operation: () => unknown) => operation,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stall: { findMany },
  },
}));

describe("public menu invalidation", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
    findMany.mockReset();
  });

  it("deduplicates stall menu invalidation tags", async () => {
    const { invalidatePublicMenus } = await import("./public-menu");

    invalidatePublicMenus(["stall-a", "stall-a", "stall-b"]);

    expect(revalidateTag).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-a", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-b", { expire: 0 });
  });

  it("invalidates every stall belonging to an organization", async () => {
    findMany.mockResolvedValue([{ id: "stall-a" }, { id: "stall-b" }]);
    const { invalidateOrganizationPublicMenus } = await import("./public-menu");

    await invalidateOrganizationPublicMenus("organization-id");

    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: "organization-id" },
      select: { id: true },
    });
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-a", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-b", { expire: 0 });
  });

  it("invalidates QR context without exposing the raw token", async () => {
    const { invalidatePublicQrToken } = await import("./public-menu");
    const token = "printed-secret-token";

    invalidatePublicQrToken(token);

    const [tag] = revalidateTag.mock.calls[0];
    expect(tag).toMatch(/^public-qr:[a-f0-9]{64}$/);
    expect(tag).not.toContain(token);
  });
});

describe("public menu locale completeness", () => {
  const translatedProduct: PublicMenuProduct = {
    id: "product-1",
    name: "牛肉湯河粉",
    description: "每日熬煮",
    price: 150,
    kind: "SINGLE",
    category: "湯河粉",
    categoryTranslations: [{ locale: "vi", name: "Phở nước" }],
    group: "牛肉湯底",
    groupTranslations: [{ locale: "vi", name: "Nước dùng bò" }],
    rank: null,
    isBestSeller: false,
    isOrderDiscountEligible: true,
    imageUrl: null,
    translations: [{ locale: "vi", name: "Phở bò", description: "Nấu mỗi ngày" }],
    noteGroups: [{
      id: "note-group-1",
      name: "辣度",
      selectionMode: "SINGLE",
      isRequired: false,
      minSelections: 0,
      maxSelections: 1,
      sortOrder: 0,
      translations: [{ locale: "vi", name: "Độ cay" }],
      options: [{
        id: "note-option-1",
        name: "小辣",
        priceDelta: 0,
        sortOrder: 0,
        translations: [{ locale: "vi", name: "Ít cay" }],
      }],
    }],
    bundleChoiceGroups: [],
  };

  it("only exposes a system locale when every displayed catalog label is translated", async () => {
    const { completePublicMenuLocales } = await import("./public-menu");

    expect(completePublicMenuLocales([translatedProduct], ["vi", "en"]))
      .toEqual(["zh-TW", "vi"]);
  });

  it("blocks a half-translated locale when a product group translation is missing", async () => {
    const { completePublicMenuLocales } = await import("./public-menu");

    expect(completePublicMenuLocales([{
      ...translatedProduct,
      groupTranslations: [],
    }], ["vi"]))
      .toEqual(["zh-TW"]);
  });
});
