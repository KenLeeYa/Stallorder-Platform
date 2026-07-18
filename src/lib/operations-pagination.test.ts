import { describe, expect, it } from "vitest";
import {
  buildOperationsPageMeta,
  parseOperationsPage,
  parseOperationsPageSize,
} from "@/lib/operations-pagination";

describe("operations pagination", () => {
  it.each([5, 10, 25, 50, 100])("accepts the supported page size %i", (pageSize) => {
    expect(parseOperationsPageSize(String(pageSize))).toBe(pageSize);
  });

  it.each([undefined, "", "0", "20", "101", "invalid"])("defaults invalid page size %s to 10", (value) => {
    expect(parseOperationsPageSize(value)).toBe(10);
  });

  it("accepts positive pages and rejects malformed values", () => {
    expect(parseOperationsPage("25")).toBe(25);
    expect(parseOperationsPage("0")).toBe(1);
    expect(parseOperationsPage("1.5")).toBe(1);
    expect(parseOperationsPage("-2")).toBe(1);
  });

  it("clamps the requested page and calculates the visible range", () => {
    expect(buildOperationsPageMeta(23, { page: 8, pageSize: 10 })).toEqual({
      page: 3,
      pageSize: 10,
      total: 23,
      totalPages: 3,
      firstItem: 21,
      lastItem: 23,
    });
    expect(buildOperationsPageMeta(0, { page: 3, pageSize: 5 })).toEqual({
      page: 1,
      pageSize: 5,
      total: 0,
      totalPages: 1,
      firstItem: 0,
      lastItem: 0,
    });
  });
});
