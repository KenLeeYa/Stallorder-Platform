import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { LotteryDraw } from "@/components/qr-lottery-dialogs";
import {
  lotteryAnimationDelay,
  lotteryProductNeedsConfiguration,
  shouldShowLotteryDialog,
} from "@/lib/qr-lottery";
import { sessionCountdownPhase, sessionSecondsRemaining } from "@/lib/session-countdown";
import type { PublicMenuProduct } from "@/lib/public-menu-types";

export const LOTTERY_REQUEST_TIMEOUT_MS = 8_000;

export type QrLotteryError = "UNAVAILABLE" | "PRODUCT_UNAVAILABLE";

export type QrOrderLotteryState = {
  draw: LotteryDraw | null;
  isDrawing: boolean;
  dialogOpen: boolean;
  limitDialogOpen: boolean;
  error: QrLotteryError | null;
  prefersReducedMotion: boolean;
};

type QrOrderLotteryAction =
  | { type: "START_DRAW" }
  | { type: "DRAW_SUCCESS"; draw: LotteryDraw; idempotentReplay: boolean }
  | { type: "DRAW_FAILURE"; reason: QrLotteryError }
  | { type: "OPEN_LIMIT" }
  | { type: "CLOSE_LIMIT" }
  | { type: "CLOSE_RESULT" }
  | { type: "CLEAR_DRAW" }
  | { type: "RESET_SESSION"; resetDraw: boolean }
  | { type: "SET_REDUCED_MOTION"; matches: boolean };

export const initialQrOrderLotteryState: QrOrderLotteryState = {
  draw: null,
  isDrawing: false,
  dialogOpen: false,
  limitDialogOpen: false,
  error: null,
  prefersReducedMotion: false,
};

export function qrOrderLotteryReducer(
  state: QrOrderLotteryState,
  action: QrOrderLotteryAction,
): QrOrderLotteryState {
  switch (action.type) {
    case "START_DRAW":
      return { ...state, isDrawing: true, dialogOpen: true, error: null };
    case "DRAW_SUCCESS":
      return {
        ...state,
        draw: action.draw,
        isDrawing: false,
        dialogOpen: !action.idempotentReplay,
        limitDialogOpen: action.idempotentReplay,
      };
    case "DRAW_FAILURE":
      return {
        ...state,
        isDrawing: false,
        dialogOpen: false,
        error: action.reason,
      };
    case "OPEN_LIMIT":
      return { ...state, limitDialogOpen: true };
    case "CLOSE_LIMIT":
      return { ...state, limitDialogOpen: false };
    case "CLOSE_RESULT":
      return { ...state, dialogOpen: false };
    case "CLEAR_DRAW":
      return { ...state, draw: null };
    case "RESET_SESSION":
      return {
        ...state,
        draw: action.resetDraw ? null : state.draw,
        limitDialogOpen: action.resetDraw ? false : state.limitDialogOpen,
        error: null,
      };
    case "SET_REDUCED_MOTION":
      return { ...state, prefersReducedMotion: action.matches };
  }
}

type QrLotteryResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

export type QrLotteryDrawEnvironment = {
  request: (
    input: { orderSessionToken: string; deviceId: string },
    signal: AbortSignal,
  ) => Promise<QrLotteryResponse>;
  wait: (delayMs: number) => Promise<void>;
  timeoutSignal: (timeoutMs: number) => AbortSignal;
  animationDelay: (prefersReducedMotion: boolean) => number;
};

export type QrLotteryDrawResult =
  | { kind: "SUCCESS"; draw: LotteryDraw; idempotentReplay: boolean }
  | { kind: "FAILURE"; reason: QrLotteryError };

export async function runQrOrderLotteryDraw(
  input: {
    orderSessionToken: string;
    deviceId: string;
    visibleProductIds: readonly string[];
    prefersReducedMotion: boolean;
  },
  environment: QrLotteryDrawEnvironment = browserLotteryDrawEnvironment,
): Promise<QrLotteryDrawResult> {
  try {
    const [response] = await Promise.all([
      environment.request({
        orderSessionToken: input.orderSessionToken,
        deviceId: input.deviceId,
      }, environment.timeoutSignal(LOTTERY_REQUEST_TIMEOUT_MS)),
      environment.wait(environment.animationDelay(input.prefersReducedMotion)),
    ]);
    if (!response.ok) return { kind: "FAILURE", reason: "UNAVAILABLE" };
    const payload = await response.json() as Record<string, unknown>;
    const draw: LotteryDraw = {
      drawId: String(payload.drawId),
      productId: String(payload.productId),
      productName: String(payload.productName),
      recommendationBasis: payload.recommendationBasis === "BEST_SELLER"
        ? "BEST_SELLER"
        : "DISCOVERY",
      discountWon: payload.discountWon === true,
      discountLabel: typeof payload.discountLabel === "string" ? payload.discountLabel : null,
    };
    if (!input.visibleProductIds.includes(draw.productId)) {
      return { kind: "FAILURE", reason: "PRODUCT_UNAVAILABLE" };
    }
    return {
      kind: "SUCCESS",
      draw,
      idempotentReplay: payload.idempotentReplay === true,
    };
  } catch {
    return { kind: "FAILURE", reason: "UNAVAILABLE" };
  }
}

type QrLotteryMediaQuery = {
  readonly matches: boolean;
  addEventListener: (type: "change", listener: () => void) => void;
  removeEventListener: (type: "change", listener: () => void) => void;
};

export function startQrLotteryReducedMotionLifecycle(
  onChange: (matches: boolean) => void,
  matchMedia: () => QrLotteryMediaQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)"),
) {
  const mediaQuery = matchMedia();
  const updatePreference = () => onChange(mediaQuery.matches);
  updatePreference();
  mediaQuery.addEventListener("change", updatePreference);
  return () => mediaQuery.removeEventListener("change", updatePreference);
}

type QrLotteryFocusEnvironment = {
  scheduleFrame: (callback: () => void) => unknown;
  scheduleTimer: (callback: () => void) => unknown;
};

export function scheduleQrLotteryTriggerFocus(
  target: { focus: () => void } | null,
  timing: "FRAME" | "TIMER",
  environment: QrLotteryFocusEnvironment = browserLotteryFocusEnvironment,
) {
  const focus = () => target?.focus();
  if (timing === "FRAME") environment.scheduleFrame(focus);
  else environment.scheduleTimer(focus);
}

export function useQrOrderLotteryController(input: {
  session: { orderSessionToken: string; expiresAt: string } | null;
  sessionReady: boolean;
  sessionExpiryDialogOpen: boolean;
  deviceId: string;
  visibleProducts: PublicMenuProduct[];
  unavailableProductMessage: string;
  onSessionPhaseChange: (phase: ReturnType<typeof sessionCountdownPhase>) => void;
  onMessage: (message: string) => void;
  onAddSimpleProduct: (productId: string) => void;
  onConfigureProduct: (productId: string) => void;
}) {
  const [state, dispatch] = useReducer(qrOrderLotteryReducer, initialQrOrderLotteryState);
  const lotteryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => startQrLotteryReducedMotionLifecycle((matches) => {
    dispatch({ type: "SET_REDUCED_MOTION", matches });
  }), []);

  const dialogVisible = shouldShowLotteryDialog({
    open: state.dialogOpen,
    hasAcceptedDraw: state.draw !== null,
    sessionExpiryDialogOpen: input.sessionExpiryDialogOpen,
  });

  const draw = useCallback(async () => {
    if (input.sessionExpiryDialogOpen) return;
    if (state.draw) {
      dispatch({ type: "OPEN_LIMIT" });
      return;
    }
    if (!input.sessionReady || !input.session || !input.deviceId || state.isDrawing) return;
    if (sessionSecondsRemaining(input.session.expiresAt) <= 60) {
      input.onSessionPhaseChange(sessionCountdownPhase(input.session.expiresAt));
      return;
    }
    dispatch({ type: "START_DRAW" });
    input.onMessage("");
    const result = await runQrOrderLotteryDraw({
      orderSessionToken: input.session.orderSessionToken,
      deviceId: input.deviceId,
      visibleProductIds: input.visibleProducts.map((product) => product.id),
      prefersReducedMotion: state.prefersReducedMotion,
    });
    if (result.kind === "SUCCESS") {
      dispatch({
        type: "DRAW_SUCCESS",
        draw: result.draw,
        idempotentReplay: result.idempotentReplay,
      });
      return;
    }
    dispatch({ type: "DRAW_FAILURE", reason: result.reason });
    scheduleQrLotteryTriggerFocus(lotteryButtonRef.current, "FRAME");
  }, [input, state.draw, state.isDrawing, state.prefersReducedMotion]);

  const cancelRecommendation = useCallback(() => {
    if (state.isDrawing) return;
    dispatch({ type: "CLOSE_RESULT" });
    scheduleQrLotteryTriggerFocus(lotteryButtonRef.current, "TIMER");
  }, [state.isDrawing]);

  const acceptRecommendation = useCallback(() => {
    if (!state.draw || !input.session || state.isDrawing) return;
    const product = input.visibleProducts.find((candidate) => candidate.id === state.draw?.productId);
    if (!product) {
      dispatch({ type: "CLOSE_RESULT" });
      input.onMessage(input.unavailableProductMessage);
      return;
    }
    if (!lotteryProductNeedsConfiguration(product)) {
      input.onAddSimpleProduct(product.id);
      dispatch({ type: "CLOSE_RESULT" });
      scheduleQrLotteryTriggerFocus(lotteryButtonRef.current, "TIMER");
      return;
    }
    input.onConfigureProduct(product.id);
    dispatch({ type: "CLOSE_RESULT" });
  }, [input, state.draw, state.isDrawing]);

  const closeLotteryLimitDialog = useCallback(() => {
    dispatch({ type: "CLOSE_LIMIT" });
  }, []);
  const clearLotteryDraw = useCallback(() => {
    dispatch({ type: "CLEAR_DRAW" });
  }, []);
  const resetLotteryForSession = useCallback((resetDraw: boolean) => {
    dispatch({ type: "RESET_SESSION", resetDraw });
  }, []);

  return useMemo(() => ({
    lotteryButtonRef,
    lotteryDraw: state.draw,
    isDrawingLottery: state.isDrawing,
    lotteryLimitDialogOpen: state.limitDialogOpen,
    lotteryError: state.error,
    prefersReducedMotion: state.prefersReducedMotion,
    lotteryDialogVisible: dialogVisible,
    drawLottery: draw,
    acceptLotteryRecommendation: acceptRecommendation,
    cancelLotteryRecommendation: cancelRecommendation,
    closeLotteryLimitDialog,
    clearLotteryDraw,
    resetLotteryForSession,
  }), [
    acceptRecommendation,
    cancelRecommendation,
    clearLotteryDraw,
    closeLotteryLimitDialog,
    dialogVisible,
    draw,
    resetLotteryForSession,
    state,
  ]);
}

const browserLotteryDrawEnvironment: QrLotteryDrawEnvironment = {
  request: async (input, signal) => fetch("/api/public/lottery-draw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  }),
  wait: (delayMs) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs)),
  timeoutSignal: (timeoutMs) => AbortSignal.timeout(timeoutMs),
  animationDelay: (prefersReducedMotion) => lotteryAnimationDelay(prefersReducedMotion),
};

const browserLotteryFocusEnvironment: QrLotteryFocusEnvironment = {
  scheduleFrame: (callback) => window.requestAnimationFrame(callback),
  scheduleTimer: (callback) => window.setTimeout(callback, 0),
};
