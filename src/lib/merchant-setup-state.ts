export type MerchantSetupCompletionEvidence = {
  goLiveCompleted: boolean;
  goLiveCompletedAt?: Date | null;
  completedAt?: Date | null;
  activatedByProfileId?: string | null;
  currentStep?: number;
  testOrderCompleted?: boolean;
  qrCode?: { state: string } | null;
  stall?: {
    orderingEnabled: boolean;
    orderingState: string;
    nonTestOrderCount?: number;
  } | null;
};

export function isMerchantSetupEffectivelyComplete(
  progress: MerchantSetupCompletionEvidence,
) {
  if (
    progress.goLiveCompleted
    || progress.goLiveCompletedAt
    || progress.completedAt
    || progress.activatedByProfileId
    || (progress.currentStep === 8 && progress.testOrderCompleted)
  ) return true;

  return progress.qrCode?.state === "ACTIVE"
    && (
      progress.stall?.orderingEnabled === true
      || progress.stall?.orderingState === "OPEN"
      || (progress.stall?.nonTestOrderCount ?? 0) > 0
    );
}
