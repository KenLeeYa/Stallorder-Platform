import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOrderHelpGuidance,
  getPublicOrderProgress,
  getPublicOrderStatusLabel,
  OrderHelpPanel,
  OrderProgressPanel,
  startVisibilityAwareOrderPolling,
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

describe("public order visibility-aware polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pauses while hidden and refreshes immediately when visible again", () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    let online = true;
    const visibilityListeners = new Set<() => void>();
    const onlineListeners = new Set<() => void>();
    const offlineListeners = new Set<() => void>();
    const refresh = vi.fn();
    const onConnectivityChange = vi.fn();

    const stop = startVisibilityAwareOrderPolling({
      environment: {
        visibilityState: () => visibility,
        online: () => online,
        scheduleInterval: (callback, intervalMs) => setInterval(callback, intervalMs) as unknown as number,
        cancelInterval: (timer) => clearInterval(timer),
        onVisibilityChange: (listener) => {
          visibilityListeners.add(listener);
          return () => visibilityListeners.delete(listener);
        },
        onOnline: (listener) => {
          onlineListeners.add(listener);
          return () => onlineListeners.delete(listener);
        },
        onOffline: (listener) => {
          offlineListeners.add(listener);
          return () => offlineListeners.delete(listener);
        },
      },
      refresh,
      onConnectivityChange,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    visibility = "hidden";
    visibilityListeners.forEach((listener) => listener());
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    visibility = "visible";
    visibilityListeners.forEach((listener) => listener());
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(4);

    online = false;
    offlineListeners.forEach((listener) => listener());
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(onConnectivityChange).toHaveBeenLastCalledWith(false);

    online = true;
    onlineListeners.forEach((listener) => listener());
    expect(refresh).toHaveBeenCalledTimes(5);
    expect(onConnectivityChange).toHaveBeenLastCalledWith(true);

    stop();
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(5);
    expect(visibilityListeners.size).toBe(0);
    expect(onlineListeners.size).toBe(0);
    expect(offlineListeners.size).toBe(0);
  });

  it("does not fetch on a hidden initial render", () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "hidden";
    const visibilityListeners = new Set<() => void>();
    const refresh = vi.fn();

    const stop = startVisibilityAwareOrderPolling({
      environment: {
        visibilityState: () => visibility,
        online: () => true,
        scheduleInterval: (callback, intervalMs) => setInterval(callback, intervalMs) as unknown as number,
        cancelInterval: (timer) => clearInterval(timer),
        onVisibilityChange: (listener) => {
          visibilityListeners.add(listener);
          return () => visibilityListeners.delete(listener);
        },
        onOnline: () => () => undefined,
        onOffline: () => () => undefined,
      },
      refresh,
      onConnectivityChange: vi.fn(),
    });

    expect(refresh).not.toHaveBeenCalled();
    visibility = "visible";
    visibilityListeners.forEach((listener) => listener());
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("coalesces slow refreshes so polling requests never overlap", async () => {
    vi.useFakeTimers();
    const pendingResolvers: Array<() => void> = [];
    const refresh = vi.fn(() => new Promise<void>((resolve) => pendingResolvers.push(resolve)));

    const stop = startVisibilityAwareOrderPolling({
      environment: {
        visibilityState: () => "visible",
        online: () => true,
        scheduleInterval: (callback, intervalMs) => setInterval(callback, intervalMs) as unknown as number,
        cancelInterval: (timer) => clearInterval(timer),
        onVisibilityChange: () => () => undefined,
        onOnline: () => () => undefined,
        onOffline: () => () => undefined,
      },
      refresh,
      onConnectivityChange: vi.fn(),
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    pendingResolvers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
    pendingResolvers.shift()?.();
    await Promise.resolve();
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
