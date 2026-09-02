import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("merchant stall QR status", () => {
  it("reads only the primary stall QR instead of a table or fulfillment QR", () => {
    expect(source).toContain("organizationId: stall.organizationId");
    expect(source).toContain("diningTableId: null");
    expect(source).toContain("fulfillmentTypeContext: null");
  });
});
