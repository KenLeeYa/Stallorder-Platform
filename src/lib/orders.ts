export const activeOrderStatuses = ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY"] as const;

export const staffStatusOptions = [
  { value: "CONFIRMED", label: "確認接單" },
  { value: "PREPARING", label: "開始製作" },
  { value: "READY", label: "可取餐" },
  { value: "COMPLETED", label: "現金結帳並完成" },
  { value: "CANCELLED", label: "取消訂單" },
] as const;

export const orderStatusLabels = {
  WAITING_CONFIRMATION: "待確認",
  CONFIRMED: "已確認",
  PREPARING: "製作中",
  READY: "可取餐",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "確認逾時",
} as const;

export const paymentStatusLabels = {
  UNPAID: "未付款",
  PAID: "已付款",
  REFUNDED: "已退款",
} as const;
