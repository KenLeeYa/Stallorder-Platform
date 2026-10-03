import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinePlatformMemberForm } from "./line-platform-member-form";

describe("platform membership before hydration", () => {
  it.each([false, true])("disables consent and submit until handlers are ready (enrolled=%s)", enrolled => {
    const html = renderToStaticMarkup(<LinePlatformMemberForm termsVersion="test" enrolled={enrolled} initialConsent />);
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(enrolled ? 2 : 3);
    for (const input of inputs) expect(input).toContain('disabled=""');
    expect(html.match(/<button[^>]*>/)?.[0]).toContain('disabled=""');
  });
});
