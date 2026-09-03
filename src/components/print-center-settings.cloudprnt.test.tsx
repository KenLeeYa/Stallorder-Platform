import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PrintCenterSettings } from "@/components/print-center-settings";
import type { PrintQueueState } from "@/lib/print-center-types";
import { MessageTestProvider } from "@/test/message-test-provider";

describe("CloudPRNT iPad setup presentation", () => {
  it("keeps the stable Server URL and User Name copyable without exposing a password hash", () => {
    const state: PrintQueueState = {
      printModuleEnabled: true,
      printers: [{
        id: "44444444-4444-4444-8444-444444444444",
        name: "廚房雲端印表機",
        connectionType: "CLOUDPRNT",
        model: "MCP31LB",
        paperWidthMm: 58,
        autoDetectEnabled: false,
        openCashDrawerOnCashPayment: false,
        isEnabled: true,
        isOnline: false,
        lastSeenAt: null,
        deviceId: "PRN_abcdefghijklmnop",
        hasCloudPrntCredentials: true,
        cloudPrntServerUrl: "https://app.qidaigo.com/api/cloudprnt/v1/PRN_abcdefghijklmnop",
      }],
      rules: [],
      catalog: [],
      jobs: [],
    };

    const html = renderToStaticMarkup(
      <MessageTestProvider initialLocale="zh-TW">
        <PrintCenterSettings
          state={state}
          busy={false}
          activePrinterId={null}
          onRun={vi.fn()}
          onTakeOver={vi.fn()}
          onTest={vi.fn()}
          onOpenCashDrawer={vi.fn()}
        />
      </MessageTestProvider>,
    );

    expect(html).toContain("data-cloudprnt-server-url");
    expect(html).toContain("https://app.qidaigo.com/api/cloudprnt/v1/PRN_abcdefghijklmnop");
    expect(html).toContain("User Name（Device ID）");
    expect(html).toContain("PRN_abcdefghijklmnop");
    expect(html).toContain("產生新的 Password");
    expect(html).toContain("break-all");
    expect(html).toContain("min-h-11");
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
    expect(html).not.toContain("a".repeat(64));
  });
});
