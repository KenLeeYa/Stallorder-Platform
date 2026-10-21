import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductFeedback } from "./product-feedback";
describe("manual feedback form", () => {
    it("renders stable labels, a deliberate submit and non-submit clear/reference controls", () => { const html = renderToStaticMarkup(<ProductFeedback identity="test" organizationId={null} requestId="11111111-1111-4111-8111-111111111111"/>); expect(html).toContain('for="feedback-message"'); expect(html).toContain('id="feedback-message"'); expect(html).toContain('maxLength="2000"'); expect(html).toContain('type="submit"'); expect(html).toMatch(/type="button"[^>]*>移除追蹤碼/); expect(html).toMatch(/type="button"[^>]*>清除內容/); expect(html).toContain("送出回饋不需同意非必要產品分析"); });
});
