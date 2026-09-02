import { describe, expect, it } from "vitest";
import { normalizeQrPrintRequest, paginateQrPrintItems } from "@/lib/qr-print-layout";

describe("QR print layout", () => {
  it("forces the all-table layout to A4 and six cut cards per sheet", () => {
    expect(normalizeQrPrintRequest({ target: "tables", paper: "A5" })).toEqual({
      target: "tables",
      paper: "A4",
      tableId: null,
    });
    expect(paginateQrPrintItems(
      Array.from({ length: 7 }, (_, index) => ({ id: String(index) })),
      "tables",
    ).map((page) => page.length)).toEqual([6, 1]);
  });

  it("supports A4, A5, and A6 for one stall or one table", () => {
    expect(normalizeQrPrintRequest({ target: "stall", paper: "A5" })).toEqual({
      target: "stall",
      paper: "A5",
      tableId: null,
    });
    expect(normalizeQrPrintRequest({ target: "table", paper: "A4", tableId: "table-1" })).toEqual({
      target: "table",
      paper: "A4",
      tableId: "table-1",
    });
    expect(normalizeQrPrintRequest({ target: "stall", paper: "a6" })).toEqual({
      target: "stall",
      paper: "A6",
      tableId: null,
    });
  });
});
