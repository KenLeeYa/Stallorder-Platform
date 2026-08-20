import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startQrOrderCartDialogLifecycle,
  startQrOrderProductDialogLifecycle,
} from "@/components/qr-order-dialog-lifecycle";

type FakeElement = {
  focus: ReturnType<typeof vi.fn>;
  getClientRects: () => { length: number };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QR order dialog lifecycle", () => {
  it("locks the mobile cart, focuses close, traps visible focus and restores listeners", () => {
    const browser = createBrowserHarness(false);
    const hidden = createElement(false);
    const first = createElement();
    const last = createElement();
    const panel = createPanel([hidden, first, last]);
    const closeButton = createElement();
    const onClose = vi.fn();

    const stop = startQrOrderCartDialogLifecycle({
      panel: panel as unknown as HTMLElement,
      closeButton: closeButton as unknown as HTMLButtonElement,
      onClose,
    });

    expect(browser.bodyStyle.overflow).toBe("hidden");
    browser.flushFrames();
    expect(closeButton.focus).toHaveBeenCalledOnce();

    browser.setActiveElement(last);
    const forwardTab = browser.keydown("Tab");
    expect(forwardTab.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();

    browser.setActiveElement(first);
    const backwardTab = browser.keydown("Tab", true);
    expect(backwardTab.preventDefault).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();

    browser.keydown("Escape");
    expect(onClose).toHaveBeenCalledOnce();
    browser.changeDesktop(true);
    expect(onClose).toHaveBeenCalledTimes(2);

    stop();
    expect(browser.bodyStyle.overflow).toBe("clip");
    expect(browser.listenerCounts()).toEqual({ keydown: 0, media: 0 });
  });

  it("closes a cart entering on desktop without locking the page", () => {
    const browser = createBrowserHarness(true);
    const onClose = vi.fn();

    const stop = startQrOrderCartDialogLifecycle({
      panel: createPanel([]) as unknown as HTMLElement,
      closeButton: createElement() as unknown as HTMLButtonElement,
      onClose,
    });

    expect(browser.bodyStyle.overflow).toBe("clip");
    expect(browser.listenerCounts()).toEqual({ keydown: 0, media: 0 });
    browser.flushFrames();
    expect(onClose).toHaveBeenCalledOnce();

    stop();
  });

  it("keeps product configuration keyboard behavior independent from desktop media", () => {
    const browser = createBrowserHarness(true);
    const panel = createPanel([]);
    const onCancel = vi.fn();

    const stop = startQrOrderProductDialogLifecycle({
      panel: panel as unknown as HTMLElement,
      onCancel,
    });

    expect(browser.bodyStyle.overflow).toBe("hidden");
    expect(browser.matchMedia).not.toHaveBeenCalled();
    browser.flushFrames();
    expect(panel.focus).toHaveBeenCalledOnce();

    const tab = browser.keydown("Tab");
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(panel.focus).toHaveBeenCalledTimes(2);
    browser.keydown("Escape");
    expect(onCancel).toHaveBeenCalledOnce();

    stop();
    expect(browser.bodyStyle.overflow).toBe("clip");
    expect(browser.listenerCounts()).toEqual({ keydown: 0, media: 0 });
  });
});

function createElement(visible = true): FakeElement {
  return {
    focus: vi.fn(),
    getClientRects: () => ({ length: visible ? 1 : 0 }),
  };
}

function createPanel(focusable: FakeElement[]) {
  return {
    ...createElement(),
    querySelectorAll: vi.fn(() => focusable),
  };
}

function createBrowserHarness(initialDesktop: boolean) {
  const bodyStyle = { overflow: "clip" };
  const keydownListeners = new Set<(event: KeyboardEvent) => void>();
  const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let activeElement: FakeElement | null = null;
  let desktop = initialDesktop;
  const mediaQuery = {
    get matches() {
      return desktop;
    },
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === "change") mediaListeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === "change") mediaListeners.delete(listener);
    }),
  };
  const matchMedia = vi.fn(() => mediaQuery);

  vi.stubGlobal("window", {
    matchMedia,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  vi.stubGlobal("document", {
    body: { style: bodyStyle },
    get activeElement() {
      return activeElement;
    },
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === "keydown") keydownListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === "keydown") keydownListeners.delete(listener);
    },
  });

  return {
    bodyStyle,
    matchMedia,
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    },
    setActiveElement(element: FakeElement) {
      activeElement = element;
    },
    keydown(key: string, shiftKey = false) {
      const event = {
        key,
        shiftKey,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;
      keydownListeners.forEach((listener) => listener(event));
      return event as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
    },
    changeDesktop(matches: boolean) {
      desktop = matches;
      const event = { matches } as MediaQueryListEvent;
      mediaListeners.forEach((listener) => listener(event));
    },
    listenerCounts() {
      return { keydown: keydownListeners.size, media: mediaListeners.size };
    },
  };
}
