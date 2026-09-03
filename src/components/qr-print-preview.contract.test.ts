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
  it("offers exact A4, A5, and A6 paper sizes for a stall", () => {
    expect(merchantProductsSource).toContain("paper=A6");
    expect(previewSource).toContain("paper=A6");
    expect(previewSource).toContain('paper === "A6" ? 105');
    expect(previewSource).toContain('paper === "A5" ? 148 : 210');
    expect(previewSource).toContain('paper === "A6" ? 148');
    expect(previewSource).toContain('paper === "A5" ? 210 : 297');
    expect(previewSource).toContain('text-[40px]');
    expect(previewSource).toContain('h-[115mm] w-[115mm]');
    expect(previewSource).toContain('text-[30px]');
  });

  it("prints only the selected QR sheets without merchant chrome or scroll containers", () => {
    expect(previewSource).toContain('@page { size: ${paper} portrait; margin: 0; }');
    expect(previewSource).toContain("#main-content:has(> .qr-print-shell) > :not(.qr-print-shell)");
    expect(previewSource).toContain(".qr-print-pages { display: block !important; overflow: visible !important; padding: 0 !important; }");
    expect(previewSource).toContain(".qr-print-sheet:last-child { break-after: auto; page-break-after: auto; }");
    expect(previewSource).toContain('className="qr-print-pages');
  });

  it("keeps the print action explicit and visibly acknowledges the click", () => {
    expect(previewSource).toContain('data-testid="qr-print-button"');
    expect(previewSource).toContain("onClick={handlePrint}");
    expect(previewSource).toContain("window.focus()");
    expect(previewSource).toContain("window.print()");
    expect(previewSource).toContain('role="status"');
  });
});
