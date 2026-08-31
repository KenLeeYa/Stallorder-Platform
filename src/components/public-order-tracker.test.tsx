import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  getOrderHelpGuidance,
  getPublicOrderProgress,
  getPublicOrderCustomerActions,
  getPublicOrderStatusLabel,
  formatOrderRefreshTime,
  OrderAmendmentNoticeDialog,
  OrderHelpPanel,
  OrderProgressPanel,
} from "./public-order-tracker";

type InteractiveElementProps = {
  "aria-label"?: string;
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
};

function findElementByAriaLabel(
  node: ReactNode,
  ariaLabel: string,
): ReactElement<InteractiveElementProps> | null {
  if (!isValidElement<InteractiveElementProps>(node)) return null;
  if (node.props["aria-label"] === ariaLabel) return node;

  let match: ReactElement<InteractiveElementProps> | null = null;
  Children.forEach(node.props.children, (child) => {
    if (!match) match = findElementByAriaLabel(child, ariaLabel);
  });
  return match;
}

describe("public order progress", () => {
  it("renders the merchant amendment as a centered customer notice", () => {
    const html = renderToStaticMarkup(
      <OrderAmendmentNoticeDialog
        notice={{
          id: "event-1",
          reason: "SOLD_OUT_REMOVE",
          message: "香酥雞已售完，已移除並重新計算金額。",
          previousTotal: 190,
          total: 95,
          createdAt: "2026-08-30T10:00:00.000Z",
        }}
        locale="zh-TW"
        currency="TWD"
        onDismiss={() => undefined}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("訂單內容已由店家調整");
    expect(html).toContain("香酥雞已售完");
    expect(html).toContain("$190");
    expect(html).toContain("$95");
  });
  it("exposes self-service modification and cancellation only at safe order stages", () => {
    expect(getPublicOrderCustomerActions("WAITING_CONFIRMATION", "TAKEOUT", "UNPAID")).toEqual({
      canModify: true,
      canCancel: true,
    });
    expect(getPublicOrderCustomerActions("CONFIRMED", "DELIVERY", "UNPAID")).toEqual({
      canModify: true,
      canCancel: false,
    });
    expect(getPublicOrderCustomerActions("PREPARING", "TAKEOUT", "UNPAID")).toEqual({
      canModify: false,
      canCancel: false,
    });
    expect(getPublicOrderCustomerActions("WAITING_CONFIRMATION", "DINE_IN", "UNPAID")).toEqual({
      canModify: false,
      canCancel: false,
    });
  });

  it.each([
    ["WAITING_CONFIRMATION", 0],
    ["CONFIRMED", 1],
    ["PREPARING", 2],
    ["PACKING", 2],
    ["READY", 3],
    ["COMPLETED", 4],
    ["CANCELLED", null],
    ["EXPIRED", null],
  ] as const)("maps %s to the expected progress step", (status, currentStep) => {
    expect(getPublicOrderProgress(status, "TAKEOUT").currentStep).toBe(currentStep);
  });

  it("renders an accessible stepper with the current state and next action", () => {
    const html = renderToStaticMarkup(
      <OrderProgressPanel orderStatus="PREPARING" fulfillmentType="TAKEOUT" />,
    );

    expect(html).toContain("aria-labelledby=\"order-progress-heading\"");
    expect(html).toContain("aria-label=\"訂單進度\"");
    expect(html).toContain("aria-current=\"step\"");
    expect(html).toContain("尚未進行：");
    expect(html).toContain("目前：");
    expect(html).toContain("餐點正在製作中。");
    expect(html).toContain("下一步：");
    expect(html).toContain("餐點完成後，畫面會顯示可取餐。");
  });

  it("uses fulfillment-specific handoff guidance", () => {
    const delivery = getPublicOrderProgress("READY", "DELIVERY");
    const dineIn = getPublicOrderProgress("READY", "DINE_IN");

    expect(delivery.steps).toContain("待配送");
    expect(delivery.nextAction).toContain("配送");
    expect(dineIn.steps).toContain("待出餐");
    expect(dineIn.nextAction).toContain("現場叫號");
    expect(getPublicOrderStatusLabel("READY", "DELIVERY")).toBe("待配送");
    expect(getPublicOrderStatusLabel("READY", "DINE_IN")).toBe("待出餐");
    expect(getPublicOrderStatusLabel("READY", "TAKEOUT")).toBe("可取餐");
  });

  it("renders Vietnamese progress chrome without translating merchant content", () => {
    const html = renderToStaticMarkup(
      <OrderProgressPanel orderStatus="PREPARING" fulfillmentType="TAKEOUT" locale="vi" />,
    );

    expect(html).toContain("Tiến độ đơn hàng");
    expect(html).toContain("Món đang được chuẩn bị");
    expect(getPublicOrderStatusLabel("READY", "DELIVERY", "vi")).toBe("Chờ giao");
  });

  it("formats refresh timestamps with the active locale", () => {
    const value = new Date("2026-08-13T08:05:06Z");
    const options = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false } as const;
    expect(formatOrderRefreshTime(value, "en")).toBe(new Intl.DateTimeFormat("en", options).format(value));
    expect(formatOrderRefreshTime(value, "vi")).toBe(new Intl.DateTimeFormat("vi", options).format(value));
  });

  it("renders stopped orders without claiming an unknown progress step", () => {
    const html = renderToStaticMarkup(
      <OrderProgressPanel orderStatus="CANCELLED" fulfillmentType="TAKEOUT" />,
    );

    expect(html).toContain("訂單已取消，流程已停止。");
    expect(html).toContain("請直接聯絡現場攤位");
    expect(html).not.toContain("aria-current=\"step\"");
  });
});

describe("public order help", () => {
  it.each([
    ["TAKEOUT", "取餐驗證碼"],
    ["DINE_IN", "桌位"],
    ["DELIVERY", "配送進度"],
  ] as const)("provides safe on-site guidance for %s", (fulfillmentType, expectedGuidance) => {
    const guidance = getOrderHelpGuidance(fulfillmentType);

    expect(guidance).toContain("重新整理");
    expect(guidance).toContain("現場人員");
    expect(guidance).toContain(expectedGuidance);
    expect(guidance).not.toMatch(/(?:tel:|mailto:|https?:\/\/)/);
  });

  it("renders an accessible help entry with no private contact link", () => {
    const html = renderToStaticMarkup(
      <OrderHelpPanel
        fulfillmentType="TAKEOUT"
        isOnline
        isRefreshing={false}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("需要協助");
    expect(html).toContain("aria-label=\"從協助區重新整理訂單狀態\"");
    expect(html).not.toContain("href=");
  });

  it("runs refresh when available and disables it while offline", () => {
    const onRefresh = vi.fn();
    const onlinePanel = OrderHelpPanel({
      fulfillmentType: "DINE_IN",
      isOnline: true,
      isRefreshing: false,
      onRefresh,
    });
    const refreshButton = findElementByAriaLabel(onlinePanel, "從協助區重新整理訂單狀態");

    expect(refreshButton?.props.disabled).toBe(false);
    refreshButton?.props.onClick?.();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const offlineHtml = renderToStaticMarkup(
      <OrderHelpPanel
        fulfillmentType="DELIVERY"
        isOnline={false}
        isRefreshing={false}
        onRefresh={onRefresh}
      />,
    );
    expect(offlineHtml).toContain("disabled=\"\"");
    expect(offlineHtml).toContain("aria-live=\"polite\"");
    expect(offlineHtml).toContain("目前裝置離線");
  });
});
