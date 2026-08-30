import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./location-guide-dialog.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("location guide dialog stacking", () => {
  it("portals the full-screen overlay to document.body", () => {
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
  });
});
