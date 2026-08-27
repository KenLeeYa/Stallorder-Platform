import type { OperationsMessageKey } from "@/lib/messages/operations";

const errorCodeKeys: Partial<Record<string, OperationsMessageKey>> = {
  PRODUCTION_NOT_DUE: "error.productionNotDue",
  NOT_FOUND: "error.notFound",
  TASK_NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  EDIT_CONFLICT: "error.conflict",
  ORDER_EDIT_CONFLICT: "error.conflict",
  ACTIVE_SHIFT_REQUIRED: "staff.error.activeShift",
  OFFLINE_READ_ONLY: "composer.offline.readOnly",
  OFFLINE_TAKEOUT_ONLY: "composer.offline.takeoutOnly",
  OFFLINE_SCHEDULED_TIME_NOT_ALLOWED: "composer.offline.generic",
  OFFLINE_DISCOUNT_NOT_ALLOWED: "composer.offline.generic",
  OFFLINE_BUNDLE_NOT_ALLOWED: "composer.offline.generic",
  OFFLINE_BOOTSTRAP_REQUIRED: "composer.offline.generic",
  OFFLINE_PERMIT_EXPIRED: "composer.offline.generic",
  OFFLINE_MENU_EXPIRED: "composer.offline.generic",
  OFFLINE_DEVICE_NOT_LEADER: "composer.offline.generic",
  OFFLINE_ACTION_NOT_ALLOWED: "composer.offline.generic",
  OFFLINE_PRODUCT_UNAVAILABLE: "composer.offline.generic",
  OFFLINE_ITEM_LIMIT_EXCEEDED: "composer.offline.generic",
  OFFLINE_NOTE_SELECTION_INVALID: "composer.offline.generic",
  OFFLINE_RISK_LIMIT_REACHED: "composer.offline.generic",
  OFFLINE_PAYMENT_NOT_ALLOWED: "composer.offline.generic",
  OFFLINE_CASH_SHIFT_REQUIRED: "composer.offline.generic",
  OFFLINE_CUSTOMER_CONTACT_REQUIRED: "composer.offline.generic",
  OFFLINE_MANAGER_REQUIRED: "composer.offline.generic",
};

export function getOperationsErrorMessageKey(
  code: unknown,
  fallbackKey: OperationsMessageKey = "common.apiError",
) {
  return typeof code === "string" ? errorCodeKeys[code] ?? fallbackKey : fallbackKey;
}
