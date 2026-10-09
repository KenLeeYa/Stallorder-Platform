import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashChangeSummary } from "./cash-change-summary";

describe("cash change summary", () => {
  it("shows the shortfall as a labeled amount", () => {
    const html = renderToStaticMarkup(<CashChangeSummary
      label="應找零" amount="$94" insufficient insufficientLabel="尚差"
    />);
    expect(html).toContain("尚差");
    expect(html).toContain("<strong");
    expect(html).toContain("$94");
  });
});
