import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicOrderFeedbackDialog } from "./public-order-feedback-dialog";

describe("public order feedback dialog", () => {
  it("presents ordering errors in a centered modal", () => {
    const html = renderToStaticMarkup(
      <PublicOrderFeedbackDialog
        title="請確認訂單"
        message="目前無法建立或查詢訂單，請稍後再試。"
        primaryLabel="我知道了"
        onPrimary={() => undefined}
      />,
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("目前無法建立或查詢訂單");
    expect(html).toContain("fixed inset-0");
  });
});
