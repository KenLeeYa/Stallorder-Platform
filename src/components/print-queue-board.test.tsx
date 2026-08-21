import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { PrintQueueBoard, type PrintQueueState } from "@/components/print-queue-board";

describe("PrintQueueBoard cancelled-job recovery", () => {
  it("keeps a cancelled streamlined print job visible with a reprint action", () => {
    const state: PrintQueueState = {
      printModuleEnabled: true,
      printers: [],
      jobs: [{
        id: "job-1",
        status: "CANCELLED",
        attemptCount: 0,
        maxAttempts: 3,
        lastError: null,
        queuedAt: "2026-08-21T10:00:00.000Z",
        printedAt: null,
        reprintOfId: null,
        printer: null,
        order: {
          id: "order-1",
          orderNo: "A-001",
          customerName: "測試顧客",
          customerPhone: null,
          deliveryAddress: null,
          tableLabel: null,
          fulfillmentType: "TAKEOUT",
          total: 100,
          createdAt: "2026-08-21T10:00:00.000Z",
          items: [],
        },
      }],
    };

    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <PrintQueueBoard
          stall={{ slug: "demo", name: "測試攤位", currency: "TWD" }}
          initialState={state}
        />
      </LocaleProvider>,
    );

    expect(html).toContain("A-001");
    expect(html).toContain("已取消");
    expect(html).toContain("補印");
  });
});
