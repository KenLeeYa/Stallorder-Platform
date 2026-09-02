import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const previewSource = readFileSync(
  fileURLToPath(new URL("./qr-print-preview.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");
const merchantProductsSource = readFileSync(
  fileURLToPath(new URL("./merchant-products.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("QR print preview paper layouts", () => {
  it("offers A6 for a stall and gives the A4 design stronger readable sizing", () => {
    expect(merchantProductsSource).toContain("paper=A6");
    expect(previewSource).toContain("paper=A6");
    expect(previewSource).toContain('paper === "A6" ? 89');
    expect(previewSource).toContain('paper === "A6" ? 132');
    expect(previewSource).toContain('text-[40px]');
    expect(previewSource).toContain('h-[115mm] w-[115mm]');
    expect(previewSource).toContain('text-[30px]');
  });
});
