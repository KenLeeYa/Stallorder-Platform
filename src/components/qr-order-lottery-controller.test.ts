import { describe, expect, it, vi } from "vitest";
import {
  initialQrOrderLotteryState,
  qrOrderLotteryReducer,
  runQrOrderLotteryDraw,
  scheduleQrLotteryTriggerFocus,
  startQrLotteryReducedMotionLifecycle,
  type QrLotteryDrawEnvironment,
} from "@/components/qr-order-lottery-controller";

const drawPayload = {
  drawId: "draw-1",
  productId: "meal",
  productName: "Meal",
  recommendationBasis: "BEST_SELLER" as const,
  discountWon: true,
  discountLabel: "九折",
  freeProductReward: false,
  qualificationType: "STANDARD" as const,
  qualificationThresholdAmount: null,
};

describe("QR order lottery controller", () => {
  it("characterizes draw, replay, failure, and session-reset state transitions", () => {
    const drawing = qrOrderLotteryReducer(initialQrOrderLotteryState, { type: "START_DRAW" });
    expect(drawing).toMatchObject({
      draw: null,
      isDrawing: true,
      dialogOpen: true,
      limitDialogOpen: false,
      error: null,
    });

    const success = qrOrderLotteryReducer(drawing, {
      type: "DRAW_SUCCESS",
      draw: drawPayload,
      idempotentReplay: false,
    });
    expect(success).toMatchObject({
      draw: drawPayload,
      isDrawing: false,
      dialogOpen: true,
      limitDialogOpen: false,
    });

    const replay = qrOrderLotteryReducer(drawing, {
      type: "DRAW_SUCCESS",
      draw: drawPayload,
      idempotentReplay: true,
    });
    expect(replay).toMatchObject({
      draw: drawPayload,
      isDrawing: false,
      dialogOpen: false,
      limitDialogOpen: true,
    });

    const failure = qrOrderLotteryReducer(drawing, {
      type: "DRAW_FAILURE",
      reason: "PRODUCT_UNAVAILABLE",
    });
    expect(failure).toMatchObject({
      isDrawing: false,
      dialogOpen: false,
      error: "PRODUCT_UNAVAILABLE",
    });
    expect(qrOrderLotteryReducer(replay, {
      type: "RESET_SESSION",
      resetDraw: true,
    })).toMatchObject({
      draw: null,
      limitDialogOpen: false,
      error: null,
    });
  });

  it("requests and normalizes a visible product while waiting for animation concurrently", async () => {
    let resolveRequest: ((value: ReturnType<typeof response>) => void) | undefined;
    const request = vi.fn(() => new Promise<ReturnType<typeof response>>((resolve) => {
      resolveRequest = resolve;
    }));
    const wait = vi.fn(async () => undefined);
    const signal = {} as AbortSignal;
    const environment = drawEnvironment({ request, wait, signal, animationDelay: 975 });

    const pending = runQrOrderLotteryDraw({
      orderSessionToken: "session-token",
      deviceId: "device-id",
      visibleProductIds: ["meal"],
      prefersReducedMotion: false,
    }, environment);

    expect(request).toHaveBeenCalledWith({
      orderSessionToken: "session-token",
      deviceId: "device-id",
      cartTotal: 0,
    }, signal);
    expect(wait).toHaveBeenCalledWith(975);
    resolveRequest?.(response(drawPayload));
    await expect(pending).resolves.toEqual({
      kind: "SUCCESS",
      draw: drawPayload,
      idempotentReplay: false,
    });
  });

  it("uses zero animation delay for reduced motion and preserves replay", async () => {
    const wait = vi.fn(async () => undefined);
    const environment = drawEnvironment({
      wait,
      animationDelay: (reduced) => reduced ? 0 : 800,
      payload: { ...drawPayload, idempotentReplay: true },
    });

    await expect(runQrOrderLotteryDraw({
      orderSessionToken: "session-token",
      deviceId: "device-id",
      visibleProductIds: ["meal"],
      prefersReducedMotion: true,
    }, environment)).resolves.toMatchObject({
      kind: "SUCCESS",
      idempotentReplay: true,
    });
    expect(wait).toHaveBeenCalledWith(0);
  });

  it("distinguishes an unavailable product from transport and timeout failures", async () => {
    await expect(runQrOrderLotteryDraw({
      orderSessionToken: "session-token",
      deviceId: "device-id",
      visibleProductIds: ["other"],
      prefersReducedMotion: false,
    }, drawEnvironment())).resolves.toEqual({
      kind: "FAILURE",
      reason: "PRODUCT_UNAVAILABLE",
    });

    await expect(runQrOrderLotteryDraw({
      orderSessionToken: "session-token",
      deviceId: "device-id",
      visibleProductIds: ["meal"],
      prefersReducedMotion: false,
    }, drawEnvironment({ ok: false }))).resolves.toEqual({
      kind: "FAILURE",
      reason: "UNAVAILABLE",
    });

    await expect(runQrOrderLotteryDraw({
      orderSessionToken: "session-token",
      deviceId: "device-id",
      visibleProductIds: ["meal"],
      prefersReducedMotion: false,
    }, drawEnvironment({ requestError: new DOMException("timed out", "TimeoutError") })))
      .resolves.toEqual({ kind: "FAILURE", reason: "UNAVAILABLE" });

  });

  it("tracks reduced-motion changes and removes its listener", () => {
    let listener: (() => void) | undefined;
    let matches = false;
    const mediaQuery = {
      get matches() {
        return matches;
      },
      addEventListener: vi.fn((_type: "change", next: () => void) => {
        listener = next;
      }),
      removeEventListener: vi.fn(),
    };
    const onChange = vi.fn();

    const stop = startQrLotteryReducedMotionLifecycle(onChange, () => mediaQuery);
    expect(onChange).toHaveBeenLastCalledWith(false);
    matches = true;
    listener?.();
    expect(onChange).toHaveBeenLastCalledWith(true);
    stop();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("returns trigger focus with the existing frame and timer timing contracts", () => {
    const target = { focus: vi.fn() };
    const scheduleFrame = vi.fn((callback: () => void) => callback());
    const scheduleTimer = vi.fn((callback: () => void) => callback());

    scheduleQrLotteryTriggerFocus(target, "FRAME", { scheduleFrame, scheduleTimer });
    scheduleQrLotteryTriggerFocus(target, "TIMER", { scheduleFrame, scheduleTimer });

    expect(scheduleFrame).toHaveBeenCalledOnce();
    expect(scheduleTimer).toHaveBeenCalledOnce();
    expect(target.focus).toHaveBeenCalledTimes(2);
  });
});

function response(payload: Record<string, unknown> = drawPayload, ok = true) {
  return {
    ok,
    json: vi.fn(async () => payload),
  };
}

function drawEnvironment(options: {
  request?: QrLotteryDrawEnvironment["request"];
  requestError?: unknown;
  wait?: QrLotteryDrawEnvironment["wait"];
  signal?: AbortSignal;
  animationDelay?: number | QrLotteryDrawEnvironment["animationDelay"];
  payload?: Record<string, unknown>;
  ok?: boolean;
} = {}): QrLotteryDrawEnvironment {
  const signal = options.signal ?? ({} as AbortSignal);
  const request = options.request ?? vi.fn(async () => {
    if (options.requestError) throw options.requestError;
    return response(options.payload ?? drawPayload, options.ok ?? true);
  });
  return {
    request,
    wait: options.wait ?? vi.fn(async () => undefined),
    timeoutSignal: vi.fn(() => signal),
    animationDelay: typeof options.animationDelay === "function"
      ? options.animationDelay
      : vi.fn(() => Number(options.animationDelay ?? 800)),
  };
}
