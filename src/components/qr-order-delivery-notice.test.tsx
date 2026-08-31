import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeliveryNoticeDialog } from "@/components/qr-order-flow-presentation";

describe("delivery reminder dialog", () => {
  it("renders merchant guidance in a centered accessible modal", () => {
    const html = renderToStaticMarkup(
      <DeliveryNoticeDialog
        title="外送前請先確認"
        message={"僅配送 3 公里內。\n大量餐點請提前一天預訂。"}
        dismissLabel="我知道了，繼續點餐"
        onDismiss={() => undefined}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("外送前請先確認");
    expect(html).toContain("僅配送 3 公里內");
    expect(html).toContain("大量餐點請提前一天預訂");
  });
});
