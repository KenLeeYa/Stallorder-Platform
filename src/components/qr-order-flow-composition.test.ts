import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(name: string) {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

const entrySource = source("./qr-order-flow.tsx");
const controllerSource = source("./qr-order-flow-controller.ts");
const presentationSource = source("./qr-order-flow-presentation.tsx");

describe("QrOrderFlow composition boundary", () => {
  it("keeps the public parent composition-only", () => {
    expect(entrySource).toContain("useQrOrderFlowController(props)");
    expect(entrySource).toContain("<QrOrderFlowPresentation controller={controller} />");
    expect(entrySource).not.toMatch(/use(?:Callback|Effect|Memo|Ref|State)\(/);
    expect(entrySource).not.toContain("fetch(");
    expect(entrySource).not.toContain("localStorage");
    expect(entrySource).not.toContain("setInterval");
  });

  it("keeps session, availability, capacity, persistence, and checkout in the controller", () => {
    expect(controllerSource).toContain("createQrOrderSessionController()");
    expect(controllerSource).toContain("startQrOrderAvailabilityLifecycle({");
    expect(controllerSource).toContain("startQrOrderCapacityLifecycle({");
    expect(controllerSource).toContain("persistQrOrderCartDraft({");
    expect(controllerSource).toContain("submitQrOrderFlowCheckout(shared)");
    expect(controllerSource).toContain("submitQrOrderEditFlowCheckout({ ...shared, trackingToken: editTrackingToken })");
    expect(controllerSource).toContain("sessionController.rotateSessionIdentity()");
  });

  it("keeps responsive menu, cart, dialogs, and status UI in the presentation", () => {
    expect(presentationSource).toContain("<QrOrderMenu");
    expect(presentationSource).toContain("<QrOrderCartPanel");
    expect(presentationSource).toContain("<QrSessionCountdown");
    expect(presentationSource).toContain("<LotteryResultDialog");
    expect(presentationSource).toContain("<SessionExpiryDialog");
    expect(presentationSource).toContain('data-testid="qr-mobile-cart-summary"');
  });
});
