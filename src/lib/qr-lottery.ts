export const LOTTERY_ANIMATION_MIN_MS = 800;
export const LOTTERY_ANIMATION_MAX_MS = 1_200;

export function lotteryAnimationDelay(
  prefersReducedMotion: boolean,
  randomValue = Math.random(),
) {
  if (prefersReducedMotion) return 0;
  const normalizedRandom = Math.min(1, Math.max(0, randomValue));
  return Math.round(
    LOTTERY_ANIMATION_MIN_MS
      + normalizedRandom * (LOTTERY_ANIMATION_MAX_MS - LOTTERY_ANIMATION_MIN_MS),
  );
}

export function lotteryProductNeedsConfiguration(product: {
  noteGroups: unknown[];
  bundleChoiceGroups: unknown[];
}) {
  return product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
}

export function shouldShowLotteryDialog(input: {
  open: boolean;
  hasAcceptedDraw: boolean;
  sessionExpiryDialogOpen: boolean;
}) {
  return input.open && (
    input.hasAcceptedDraw || !input.sessionExpiryDialogOpen
  );
}
