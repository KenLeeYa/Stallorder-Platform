export const subscriptionStatusLabels: Record<string, string> = {
  TRIALING: "試用中",
  ACTIVE: "使用中",
  PAST_DUE: "帳款逾期",
  GRACE_PERIOD: "寬限期",
  SUSPENDED: "已停權",
  CANCELLED: "已取消",
};

export const invoiceStatusLabels: Record<string, string> = {
  DRAFT: "草稿",
  OPEN: "待付款",
  PAID: "已付清",
  VOID: "已作廢",
  OVERDUE: "已逾期",
  CANCELLED: "已取消",
};

export const paymentStatusLabels: Record<string, string> = {
  PENDING_VERIFICATION: "待確認",
  VERIFIED: "已確認",
  REJECTED: "未通過",
  VOIDED: "已作廢",
};

export const paymentMethodLabels: Record<string, string> = {
  BANK_TRANSFER: "銀行轉帳",
  CASH: "現金",
  LINE_PAY_MANUAL: "LINE Pay 人工紀錄",
  OTHER: "其他",
};

export const billingFeatureLabels: Record<string, string> = {
  QR_ORDERING: "QR 點餐",
  MANUAL_CHECKOUT: "人工結帳",
  PRODUCT_MANAGEMENT: "商品管理",
  SOLD_OUT_CONTROL: "售罄管理",
  BUSINESS_HOURS: "營業時間",
  BASIC_REPORTS: "基本報表",
  ADVANCED_REPORTS: "進階報表",
  CSV_EXPORT: "CSV 匯出",
  MODIFIERS: "商品註記與加價",
  KITCHEN_VIEW: "廚房檢視",
  KDS: "廚房生產看板",
  STAFF_ROLES: "員工角色",
  MULTIPLE_QR_CODES: "多組 QR Code",
  MULTI_STALL_BASIC: "多攤位管理",
  MULTI_STALL_DASHBOARD: "多攤位儀表板",
  SCHEDULED_REPORTS: "排程報表",
  CUSTOM_BRANDING: "自訂品牌",
  CUSTOM_DOMAIN: "自訂網域",
  AUDIT_VIEWER: "稽核檢視",
  OPERATIONAL_ALERTS: "營運警示",
  BULK_PRODUCT_ASSIGNMENT: "批次商品指派",
  BULK_STALL_CONTROL: "批次攤位控制",
  PRINTER_INTEGRATION: "列印整合",
  API_ACCESS: "API 存取",
  WEBHOOK_ACCESS: "Webhook 存取",
  PRIORITY_SUPPORT: "優先支援",
  PRODUCT_SALES_REPORT: "商品銷售報表",
  PAYMENT_REPORT: "付款報表",
};

export function featureLabel(code: string) {
  return billingFeatureLabels[code] ?? `功能：${code.replaceAll("_", " ")}`;
}
