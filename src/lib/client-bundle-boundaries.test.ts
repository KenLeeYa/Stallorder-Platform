import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("client bundle boundaries", () => {
  it("keeps the root PWA runtime independent from the operations catalog", () => {
    expect(source("src/components/pwa-runtime.tsx")).not.toContain("operations-locale");
    expect(source("src/components/fulfillment-time-picker.tsx")).not.toContain("operations-locale");
    expect(source("src/lib/messages/operations.ts")).not.toMatch(/"(?:pwa\.offline|fulfillment\.asap)"/);
  });

  it("keeps fulfillment and special-closure browser helpers free of Zod", () => {
    expect(source("src/lib/fulfillment-time-client.ts")).not.toMatch(/from ["']zod["']/);
    expect(source("src/lib/special-closures-client.ts")).not.toMatch(/from ["']zod["']/);
  });

  it("loads offline validation only when staff offline controls are needed", () => {
    const staffPresentation = source("src/components/staff-order-board-presentation.tsx");
    expect(staffPresentation).toContain("dynamic(");
    expect(staffPresentation).not.toMatch(/^import \{ Offline(?:BootstrapControl|QueueStatus)/m);
  });

  it("retains Zod at the server command-validation boundaries", () => {
    expect(source("src/lib/fulfillment-time.ts")).toMatch(/from ["']zod["']/);
    expect(source("src/lib/special-closures.ts")).toMatch(/from ["']zod["']/);
  });
});
