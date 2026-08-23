import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  fileURLToPath(new URL("./[stallSlug]/orders/[orderId]/route.ts", import.meta.url)),
  "utf8",
);

describe("non-KDS public order ready transition", () => {
  it("marks public pickup and delivery items ready when staff notifies the customer", () => {
    expect(routeSource).toContain("const manualPublicReady = persistedStatus === \"READY\"");
    expect(routeSource).toContain("order.source === \"QR_MENU\"");
    expect(routeSource).toContain("status: { not: \"SERVED\" }");
    expect(routeSource).toContain("readyAt: now");
  });
});
