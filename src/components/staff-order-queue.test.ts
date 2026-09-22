import { describe, expect, it } from "vitest";
import { getStaffQueue, filterStaffQueue, STAFF_QUEUE_PAGE_SIZE, type QueueOrder } from "./staff-order-queue";

const order = (id: string, overrides: Partial<QueueOrder> = {}): QueueOrder => ({
  id, status: "CONFIRMED", primaryPrintStatus: null, ...overrides,
});

describe("staff queue read model", () => {
  it("keeps payment and fulfillment states independent from production filters", () => {
    const orders = [order("waiting", { status: "WAITING_CONFIRMATION" }), order("confirmed"), order("preparing", { status: "PREPARING" }), order("packing", { status: "PACKING" }), order("ready", { status: "READY" })];
    expect(getStaffQueue(orders, "WAITING", 1).orders.map((row) => row.id)).toEqual(["waiting"]);
    expect(getStaffQueue(orders, "WORKING", 1).orders.map((row) => row.id)).toEqual(["confirmed", "preparing", "packing"]);
    expect(getStaffQueue(orders, "READY", 1).orders.map((row) => row.id)).toEqual(["ready"]);
  });
  it("surfaces failed primary printing without classifying an in-flight print as failure", () => {
    const orders = [order("failed", { primaryPrintStatus: "FAILED" }), order("cancelled", { primaryPrintStatus: "CANCELLED" }), order("printing", { primaryPrintStatus: "PRINTING" }), order("done", { primaryPrintStatus: "SUCCEEDED" })];
    expect(getStaffQueue(orders, "PRINT_ATTENTION", 1).orders.map((row) => row.id)).toEqual(["failed", "cancelled"]);
    expect(getStaffQueue(orders, "WORKING", 1).counts.PRINT_ATTENTION).toBe(2);
  });
  it("bounds 105 orders to five per page without dropping or duplicating any order", () => {
    const orders = Array.from({ length: 105 }, (_, i) => order(String(i)));
    expect(STAFF_QUEUE_PAGE_SIZE).toBe(5);
    expect(getStaffQueue(orders, "ALL", 1).totalPages).toBe(21);
    const pages = Array.from({ length: 21 }, (_, i) => getStaffQueue(orders, "ALL", i + 1).orders);
    expect(pages.flat().map((row) => row.id)).toEqual(orders.map((row) => row.id));
  });
  it("clamps a page after orders complete and returns an honest empty state", () => {
    expect(getStaffQueue([order("remaining")], "ALL", 20).page).toBe(1);
    const empty = getStaffQueue([order("ready", { status: "READY" })], "WAITING", 2);
    expect(empty.orders).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.page).toBe(1);
  });
  it("preserves incoming priority and never mutates the server read model", () => {
    const orders = Object.freeze([Object.freeze(order("b")), Object.freeze(order("a"))]);
    expect(getStaffQueue(orders, "ALL", 1).orders.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

it("combines source and a rolling hour without changing the input", () => {
  const rows = [
    { id: "old", source: "QR_MENU", createdAt: "2026-09-23T00:59:59Z" },
    { id: "boundary", source: "QR_MENU", createdAt: "2026-09-23T01:00:00Z" },
    { id: "staff", source: "STAFF_POS", createdAt: "2026-09-23T01:30:00Z" },
  ];
  expect(filterStaffQueue(rows, "QR_MENU", true, new Date("2026-09-23T02:00:00Z")).map((row) => row.id)).toEqual(["boundary"]);
  expect(filterStaffQueue(rows, "ALL", false, new Date()).length).toBe(3);
});
