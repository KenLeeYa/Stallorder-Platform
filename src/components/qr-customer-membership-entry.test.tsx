import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  QrCustomerMembershipEntry,
  qrMembershipPreviewCopy,
} from "@/components/qr-customer-membership-entry";

describe("QrCustomerMembershipEntry", () => {
  it("exposes a local-only optional member entry without blocking guest ordering", () => {
    const html = renderToStaticMarkup(
      <QrCustomerMembershipEntry locale="zh-TW" preview />,
    );

    expect(html).toContain('data-testid="qr-member-entry"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(qrMembershipPreviewCopy["zh-TW"].description).toContain("訪客仍可直接點餐");
  });

  it("renders nothing when the local preview is disabled", () => {
    expect(renderToStaticMarkup(
      <QrCustomerMembershipEntry locale="zh-TW" preview={false} />,
    )).toBe("");
  });
});
