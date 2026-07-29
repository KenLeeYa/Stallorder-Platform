import { describe, expect, it } from "vitest";
import {
  buildPublicOfflineMenuCatalog,
  hashOfflineMenuCatalog,
} from "@/server/offline/offline-menu-snapshot-service";

describe("offline menu snapshot hash", () => {
  it("is stable when object key insertion order differs", () => {
    expect(hashOfflineMenuCatalog({
      products: [{ id: "p1", price: 95 }],
      currency: "TWD",
    })).toBe(hashOfflineMenuCatalog({
      currency: "TWD",
      products: [{ price: 95, id: "p1" }],
    }));
  });

  it("changes when an authoritative price or sold-out state changes", () => {
    const baseline = hashOfflineMenuCatalog({
      products: [{ id: "p1", price: 95, isSoldOut: false }],
    });
    expect(hashOfflineMenuCatalog({
      products: [{ id: "p1", price: 110, isSoldOut: false }],
    })).not.toBe(baseline);
    expect(hashOfflineMenuCatalog({
      products: [{ id: "p1", price: 95, isSoldOut: true }],
    })).not.toBe(baseline);
  });

  it("publishes only enabled catalog entries and active modifier options", () => {
    const publicCatalog = buildPublicOfflineMenuCatalog({
      categories: [
        { id: "c1", isActive: true },
        { id: "c2", isActive: false },
      ],
      groups: [
        { id: "g1", isActive: true },
        { id: "g2", isActive: false },
      ],
      products: [
        {
          id: "p1",
          categoryId: "c1",
          groupId: "g1",
          isActive: true,
          isEnabled: true,
          noteGroups: [{
            id: "n1",
            isActive: true,
            options: [
              { id: "o1", isActive: true },
              { id: "o2", isActive: false },
            ],
          }],
        },
        {
          id: "p2",
          categoryId: "c1",
          groupId: "g1",
          isActive: true,
          isEnabled: false,
          noteGroups: [],
        },
        {
          id: "p3",
          categoryId: "c2",
          groupId: null,
          isActive: true,
          isEnabled: true,
          noteGroups: [],
        },
        {
          id: "p4",
          categoryId: "c1",
          groupId: "g2",
          isActive: true,
          isEnabled: true,
          noteGroups: [],
        },
      ],
    });

    expect(publicCatalog.categories.map((category) => category.id)).toEqual(["c1"]);
    expect(publicCatalog.groups.map((group) => group.id)).toEqual(["g1"]);
    expect(publicCatalog.products.map((product) => product.id)).toEqual(["p1"]);
    expect(publicCatalog.products[0]?.noteGroups[0]?.options).toEqual([
      { id: "o1", isActive: true },
    ]);
  });
});
