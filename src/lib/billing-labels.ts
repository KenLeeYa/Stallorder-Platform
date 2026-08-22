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
  CDS: "顧客取餐顯示",
  WAIT_TIME_QUOTE: "等候時間預估",
  CAPACITY_CONTROL: "產能與自動接單控制",
  CASH_SHIFT: "現金交班",
  CASH_RECONCILIATION: "現金短溢收複核",
  STALL_LOCATION: "出攤地點",
  STALL_SCHEDULE: "出攤行程與活動",
  LINE_NOTIFICATIONS: "LINE 訂單通知",
  LINE_ORDER_LINKING: "LINE 帳號綁定",
  LINE_REPEAT_ORDER: "LINE 再次點餐",
  STAFF_ROLES: "員工角色",
  MULTIPLE_QR_CODES: "多組 QR Code",
  MULTI_STALL_BASIC: "多攤位管理",
  MULTI_STALL_DASHBOARD: "多攤位儀表板",
  SCHEDULED_REPORTS: "排程報表",
  CUSTOM_BRANDING: "自訂品牌",
  CUSTOM_DOMAIN: "自訂網域",
  WHITE_LABEL: "白標品牌服務",
  SSO: "單一登入（SSO）",
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
  DELIVERY_PLATFORM_INTEGRATIONS: "外送平台整合",
  UBER_EATS_INTEGRATION: "Uber Eats 整合",
  FOODPANDA_INTEGRATION: "foodpanda 整合",
  DELIVERY_MENU_SYNC: "外送平台菜單同步",
  DELIVERY_ORDER_IMPORT: "外送平台訂單匯入",
  DELIVERY_ORDER_RECONCILIATION: "外送平台訂單核對",
};

export const billingPlanLabels: Record<string, string> = {
  TRIAL: "免費試用方案",
  PAYG: "PAYG 按量計費方案",
  LITE: "入門方案",
  STANDARD: "標準方案",
  PRO: "專業方案",
  ENTERPRISE: "企業方案",
};

export const billingAddOnLabels: Record<string, string> = {
  ADDITIONAL_STALL_STANDARD: "標準方案額外攤位",
  ADDITIONAL_STALL_PRO: "專業方案額外攤位",
  CUSTOM_DOMAIN: "自訂網域",
  PRINTER_INTEGRATION: "列印整合",
  SCHEDULED_REPORTS: "排程報表",
  WHITE_LABEL: "白標品牌服務",
  API_ACCESS: "API 存取",
  CUSTOM_SERVICE: "客製服務",
  ORDER_PACKAGE_LITE_100: "入門方案 100 筆訂單包",
  ORDER_PACKAGE_STANDARD_500: "標準方案 500 筆訂單包",
  ORDER_PACKAGE_PRO_1000: "專業方案 1,000 筆訂單包",
};

export function featureLabel(code: string) {
  return billingFeatureLabels[code] ?? `未命名功能（${code}）`;
}

export function planLabel(code: string, fallback?: string) {
  return billingPlanLabels[code] ?? fallback ?? `未命名方案（${code}）`;
}

export function addOnLabel(code: string, fallback?: string) {
  return billingAddOnLabels[code] ?? fallback ?? `未命名加購項目（${code}）`;
}
