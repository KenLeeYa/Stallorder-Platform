import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

describe("staff checkout compact layout", () => {
  const selector = source("./staff-discount-selector.tsx");
  const composer = source("./staff-order-composer.tsx");
  const lifecycle = source("./staff-order-board-checkout-lifecycle.tsx");

  it("uses a compact discount button and centered selection dialog", () => {
    expect(selector).toContain('data-testid="staff-discount-trigger"');
    expect(selector).toContain('data-testid="staff-discount-dialog"');
    expect(selector).toContain('aria-modal="true"');
    expect(selector).not.toContain('t("discount.availableHint")');
    expect(selector).not.toContain('t("discount.manage")');
  });

  it("places the discount button left of a constrained cash input", () => {
    expect(composer).toContain('data-testid="staff-checkout-cash-row"');
    expect(lifecycle).toContain('data-testid="staff-checkout-cash-row"');
    expect(composer).toContain('data-testid="staff-cash-received-field"');
    expect(lifecycle).toContain('data-testid="staff-cash-received-field"');
    expect(composer).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(lifecycle).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(composer).toContain("grid-cols-[auto_minmax(0,11rem)]");
    expect(lifecycle).toContain("grid-cols-[auto_minmax(0,11rem)]");
    expect(composer).not.toContain("max-w-[45vw]");
    expect(lifecycle).not.toContain("max-w-[45vw]");
  });

  it("keeps the two-stage checkout controls on one non-scrolling page", () => {
    const controls = composer.slice(
      composer.indexOf('data-testid="staff-order-checkout-controls"'),
      composer.indexOf('data-testid="staff-checkout-payment-row"'),
    );
    expect(controls).toContain("overflow-hidden");
    expect(controls).not.toContain("overflow-y-auto");
    expect(composer).toContain("sm:p-3 lg:p-6");
    expect(composer).toContain('className="mt-1 hidden text-sm text-stone-600 lg:block"');
  });
});
