import { describe, expect, it } from "vitest";
import {
  LOTTERY_ANIMATION_MAX_MS,
  LOTTERY_ANIMATION_MIN_MS,
  lotteryAnimationDelay,
  lotteryProductNeedsConfiguration,
  shouldShowLotteryDialog,
} from "@/lib/qr-lottery";

describe("qr lottery", () => {
  it("keeps the visual draw between 0.8 and 1.2 seconds", () => {
    expect(lotteryAnimationDelay(false, 0)).toBe(LOTTERY_ANIMATION_MIN_MS);
    expect(lotteryAnimationDelay(false, 0.5)).toBe(1_000);
    expect(lotteryAnimationDelay(false, 1)).toBe(LOTTERY_ANIMATION_MAX_MS);
  });

  it("does not delay when reduced motion is preferred", () => {
    expect(lotteryAnimationDelay(true, 0.5)).toBe(0);
  });

  it("requires product configuration for note or bundle groups", () => {
    expect(lotteryProductNeedsConfiguration({ noteGroups: [], bundleChoiceGroups: [] })).toBe(false);
    expect(lotteryProductNeedsConfiguration({ noteGroups: [{}], bundleChoiceGroups: [] })).toBe(true);
    expect(lotteryProductNeedsConfiguration({ noteGroups: [], bundleChoiceGroups: [{}] })).toBe(true);
  });

  it("keeps an accepted draw visible when its response crosses the session warning threshold", () => {
    const secondsRemainingAtRequest = 61;
    const secondsRemainingAtResponse = 60;
    const requestMayStart = secondsRemainingAtRequest > 60;
    const sessionExpiryDialogOpen = secondsRemainingAtResponse <= 60;

    expect(requestMayStart).toBe(true);
    expect(shouldShowLotteryDialog({
      open: true,
      hasAcceptedDraw: true,
      sessionExpiryDialogOpen,
    })).toBe(true);
  });

  it("lets the session warning replace an unfinished draw", () => {
    expect(shouldShowLotteryDialog({
      open: true,
      hasAcceptedDraw: false,
      sessionExpiryDialogOpen: true,
    })).toBe(false);
  });
});
