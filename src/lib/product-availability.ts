import { manualProductPauseActive } from "../../supabase/functions/_shared/product-availability";

/** Manual pauses expire independently of counted stock and permanent delisting. */
export function isProductSoldOut(
  assignment: { isSoldOut: boolean; soldOutUntil?: Date | string | null },
  now: Date = new Date(),
) {
  return manualProductPauseActive(assignment.isSoldOut, assignment.soldOutUntil, now);
}

export function productAvailabilityLabel(
  assignment: { isEnabled: boolean; isSoldOut: boolean; soldOutUntil?: Date | string | null; stockRemaining?: number | null },
  now: Date = new Date(),
) {
  if (!assignment.isEnabled) return "永久下架";
  if (isProductSoldOut(assignment, now)) return "暫停供應";
  if (assignment.stockRemaining === 0) return "庫存售完";
  return "供應中";
}
