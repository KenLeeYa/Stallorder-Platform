import { describe, expect, it } from "vitest";
import type { PrintJobView } from "@/lib/print-center-types";
import {
  filterPrintJobsByDate,
  printJobDateRange,
  slicePrintJobPage,
} from "@/lib/print-job-list";

function job(id: string, createdAt: string): PrintJobView {
  return {
    id,
    documentType: "KITCHEN_TICKET",
    status: "SUCCEEDED",
    attemptCount: 1,
    maxAttempts: 3,
    lastError: null,
    queuedAt: createdAt,
    printedAt: createdAt,
    reprintOfId: null,
    isRoutingCopy: false,
    printer: null,
    printRule: null,
    order: {
      id: `order-${id}`,
      orderNo: id,
      customerName: "顧客",
      customerPhone: null,
      deliveryAddress: null,
      tableLabel: null,
      fulfillmentType: "TAKEOUT",
      total: 100,
      createdAt,
      items: [],
    },
  };
}

describe("print job history filters", () => {
  it("uses Taiwan calendar dates for day, week, and month presets", () => {
    const now = new Date("2026-09-03T16:30:00.000Z");
    expect(printJobDateRange("TODAY", now)).toEqual({ dateFrom: "2026-09-04", dateTo: "2026-09-04" });
    expect(printJobDateRange("YESTERDAY", now)).toEqual({ dateFrom: "2026-09-03", dateTo: "2026-09-03" });
    expect(printJobDateRange("WEEK", now)).toEqual({ dateFrom: "2026-08-31", dateTo: "2026-09-04" });
    expect(printJobDateRange("MONTH", now)).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-04" });
  });

  it("filters inclusively and defaults each page to five records", () => {
    const jobs = Array.from({ length: 7 }, (_, index) => (
      job(String(index + 1), `2026-09-03T${String(index + 1).padStart(2, "0")}:00:00.000Z`)
    ));
    const filtered = filterPrintJobsByDate(jobs, "2026-09-03", "2026-09-03");
    const page = slicePrintJobPage(filtered, 1, 5);

    expect(filtered).toHaveLength(7);
    expect(filterPrintJobsByDate(jobs, "", "")).toHaveLength(7);
    expect(page.items).toHaveLength(5);
    expect(page.pagination).toMatchObject({ page: 1, pageSize: 5, total: 7, totalPages: 2 });
  });
});
