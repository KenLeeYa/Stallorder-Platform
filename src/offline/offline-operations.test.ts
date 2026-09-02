import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareOfflineOrderItemSnapshots } from "@/offline/offline-operations";

const productId = "10000000-0000-4000-8000-000000000001";
const noteGroupId = "20000000-0000-4000-8000-000000000001";
const eggId = "30000000-0000-4000-8000-000000000001";
const cheeseId = "30000000-0000-4000-8000-000000000002";

const catalog = {
  limits: {
    maxItemQuantity: 5,
    maxUniqueProducts: 1,
    maxTotalQuantity: 10,
    maxNoteLength: 100,
  },
  products: [{
    id: productId,
    categoryId: "40000000-0000-4000-8000-000000000001",
    name: "香酥雞排",
    description: null,
    imageUrl: null,
    price: 95,
    isActive: true,
    isEnabled: true,
    isSoldOut: false,
    availableFrom: null,
    availableUntil: null,
    noteGroups: [{
      id: noteGroupId,
      name: "加料",
      selectionMode: "MULTIPLE" as const,
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
      sortOrder: 0,
      isActive: true,
      options: [{
        id: eggId,
        name: "加蛋",
        priceDelta: 15,
        sortOrder: 0,
        isActive: true,
      }, {
        id: cheeseId,
        name: "加起司",
        priceDelta: 20,
        sortOrder: 1,
        isActive: true,
      }],
    }],
  }],
};

describe("offline staff order item preparation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates independent snapshots for one product with different notes", () => {
    const snapshots = prepareOfflineOrderItemSnapshots([
      { productId, quantity: 2, note: "", noteOptionIds: [eggId] },
      { productId, quantity: 1, note: "", noteOptionIds: [cheeseId] },
    ], catalog, new Date("2026-08-06T01:00:00.000Z"));

    expect(snapshots).toHaveLength(2);
    expect(new Set(snapshots.map((item) => item.productId))).toEqual(new Set([productId]));
    expect(snapshots.map((item) => item.quantity)).toEqual([2, 1]);
    expect(snapshots.map((item) => item.noteOptions[0]?.optionName)).toEqual(["加蛋", "加起司"]);
    expect(snapshots.map((item) => item.unitPrice)).toEqual([110, 115]);
  });

  it("creates item identifiers when HTTP LAN browsers only expose getRandomValues", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0));
    vi.stubGlobal("crypto", { getRandomValues });

    const [snapshot] = prepareOfflineOrderItemSnapshots([
      { productId, quantity: 1, note: "", noteOptionIds: [] },
    ], catalog, new Date("2026-08-06T01:00:00.000Z"));

    expect(snapshot.localItemId).toBe("00000000-0000-4000-8000-000000000000");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("keeps products marked sold out online available for onsite staff orders", () => {
    const [snapshot] = prepareOfflineOrderItemSnapshots([
      { productId, quantity: 1, note: "", noteOptionIds: [] },
    ], {
      ...catalog,
      products: [{ ...catalog.products[0], isSoldOut: true }],
    }, new Date("2026-08-06T01:00:00.000Z"));

    expect(snapshot.productId).toBe(productId);
  });
});
