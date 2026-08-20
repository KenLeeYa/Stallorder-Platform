import { describe, expect, it, vi } from "vitest";
import type { StaffCapacityData } from "@/lib/capacity-contract";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import {
  loadStaffOrderPosConfiguration,
  prepareStaffOrderComposerIntake,
  selectStaffOrderPosSnapshot,
  type StaffOrderPosConfiguration,
  type StaffOrderPosSnapshot,
} from "@/components/staff-order-board-pos";

const catalog: StaffOrderCatalog = {
  products: [],
  tables: [],
  fulfillmentSlots: [],
  limits: {
    maxItemQuantity: 20,
    maxUniqueProducts: 30,
    maxTotalQuantity: 50,
    maxNoteLength: 200,
  },
};

const capacity = { marker: "capacity" } as unknown as StaffCapacityData;

const current: StaffOrderPosSnapshot = {
  modules: {
    dineIn: false,
    delivery: false,
    print: false,
    payment: false,
    discount: false,
    discountApprovalThresholdBps: 0,
  },
  paymentOptions: [{ id: "cash-old", name: "現金", kind: "CASH" }],
  discountOptions: [{ id: "discount-old", name: "舊折扣", rateBps: 500 }],
  catalog,
  capacity,
};

const latest: StaffOrderPosConfiguration = {
  modules: {
    dineIn: true,
    delivery: true,
    print: true,
    payment: true,
    discount: true,
    discountApprovalThresholdBps: 1_000,
  },
  paymentOptions: [{ id: "custom-new", name: "信用卡", kind: "CUSTOM" }],
  discountOptions: [{ id: "discount-new", name: "新折扣", rateBps: 1_000 }],
  catalog: null,
};

describe("staff order board POS configuration", () => {
  it("loads the no-store configuration contract and requests catalog only when needed", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(latest), { status: 200 }));

    await expect(loadStaffOrderPosConfiguration({
      stallSlug: "night-market",
      fetchImpl,
    })).resolves.toEqual(latest);
    await expect(loadStaffOrderPosConfiguration({
      stallSlug: "night-market",
      includeCatalog: true,
      fetchImpl,
    })).resolves.toEqual(latest);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/stalls/night-market/pos-configuration",
      { cache: "no-store" },
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/stalls/night-market/pos-configuration?includeCatalog=true",
      { cache: "no-store" },
    );
  });

  it("surfaces the API error and keeps the existing default message", async () => {
    const apiError = vi.fn(async () => new Response(
      JSON.stringify({ error: "設定已失效。" }),
      { status: 403 },
    ));
    const emptyError = vi.fn(async () => new Response("{}", { status: 500 }));

    await expect(loadStaffOrderPosConfiguration({
      stallSlug: "night-market",
      fetchImpl: apiError,
    })).rejects.toThrow("設定已失效。");
    await expect(loadStaffOrderPosConfiguration({
      stallSlug: "night-market",
      fetchImpl: emptyError,
    })).rejects.toThrow("目前無法更新店員點餐設定。");
  });

  it("selects one coherent snapshot and preserves catalog and capacity absent from refresh", () => {
    expect(selectStaffOrderPosSnapshot(current, latest)).toEqual({
      ...latest,
      catalog,
      capacity,
    });
    expect(selectStaffOrderPosSnapshot(current, null)).toBe(current);
  });

  it("replaces a refreshed catalog while retaining the independent capacity snapshot", () => {
    const refreshedCatalog = { ...catalog, fulfillmentSlots: ["12:00"] };

    expect(selectStaffOrderPosSnapshot(current, {
      ...latest,
      catalog: refreshedCatalog,
    })).toEqual({
      ...latest,
      catalog: refreshedCatalog,
      capacity,
    });
  });

  it("opens composer with fresh or existing catalog and blocks only when neither exists", () => {
    expect(prepareStaffOrderComposerIntake(current, null)).toBe(current);
    expect(prepareStaffOrderComposerIntake(current, latest)).toEqual({
      ...latest,
      catalog,
      capacity,
    });

    const withoutCatalog = { ...current, catalog: null };
    expect(prepareStaffOrderComposerIntake(withoutCatalog, latest)).toBeNull();
    expect(prepareStaffOrderComposerIntake(withoutCatalog, {
      ...latest,
      catalog,
    })).toEqual({
      ...latest,
      catalog,
      capacity,
    });
  });
});
