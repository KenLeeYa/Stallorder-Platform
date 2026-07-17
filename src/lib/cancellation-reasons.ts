import type { CancellationReason } from "@prisma/client";

export const cancellationReasonLabels: Record<CancellationReason, string> = {
  SOLD_OUT: "商品售罄",
  CUSTOMER_CANCELLED: "顧客取消",
  WAIT_TOO_LONG: "等待過久",
  DUPLICATE_ORDER: "重複或誤下單",
  OTHER: "其他原因",
};

export const cancellationReasonOptions = Object.entries(cancellationReasonLabels).map(([value, label]) => ({
  value: value as CancellationReason,
  label,
}));
