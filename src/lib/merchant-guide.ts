import type { UserRole } from "@prisma/client";
import type { MerchantMessageKey } from "@/lib/messages/merchant";
import { hasPermission, type Permission } from "@/lib/rbac";

export type MerchantGuideCategory =
  | "start"
  | "ordering"
  | "catalog"
  | "operations"
  | "reports"
  | "people"
  | "growth"
  | "security";

export type MerchantGuideKind =
  | "setup"
  | "configure"
  | "operate"
  | "report"
  | "integration"
  | "security";

export type MerchantGuideFeature = "billing" | "growth" | "payments" | "supply";

export type MerchantGuideCustomTitle =
  | "stallOperations"
  | "staffPos"
  | "kitchenBoard"
  | "printQueue"
  | "reportOverview"
  | "reportOrders"
  | "reportProducts"
  | "reportStalls"
  | "reportPayments"
  | "qrPrint";

export type MerchantGuideNote =
  | "availability"
  | "specialHours"
  | "productVisibility"
  | "printing"
  | "kds"
  | "cashShift"
  | "supply"
  | "attendance"
  | "integration"
  | "accountSecurity";

export type MerchantGuideStall = {
  id: string;
  name: string;
  slug: string;
  kdsEnabled: boolean;
  roles: UserRole[];
};

export type MerchantGuideScope = {
  organizationId: string;
  operatingMode: "SINGLE_STALL" | "MULTI_STALL";
  merchantSetupState: "IN_PROGRESS" | "COMPLETED" | null;
  roles: UserRole[];
  stall: MerchantGuideStall | null;
  features: Record<MerchantGuideFeature, boolean>;
};

type MerchantGuideTitle =
  | { messageKey: MerchantMessageKey; customTitle?: never }
  | { messageKey?: never; customTitle: MerchantGuideCustomTitle };

export type MerchantGuideItem = MerchantGuideTitle & {
  id: string;
  category: MerchantGuideCategory;
  kind: MerchantGuideKind;
  permissions?: readonly Permission[];
  feature?: MerchantGuideFeature;
  requiresStall?: boolean;
  requiresKds?: boolean;
  multiStallOnly?: boolean;
  setupInProgressOnly?: boolean;
  note?: MerchantGuideNote;
  href: (scope: MerchantGuideScope) => string;
};

const organizationHref = (path: string) => (scope: MerchantGuideScope) => (
  `${path}?organizationId=${encodeURIComponent(scope.organizationId)}`
);

const stallHref = (path: string) => (scope: MerchantGuideScope) => {
  const stallId = scope.stall?.id ?? "";
  return `/merchant/stalls/${encodeURIComponent(stallId)}${path}`;
};

const guideItems = [
  {
    id: "merchant-setup",
    category: "start",
    kind: "setup",
    messageKey: "開店設定",
    permissions: ["MANAGE_ORGANIZATION"],
    setupInProgressOnly: true,
    href: organizationHref("/merchant/setup"),
  },
  {
    id: "operations-overview",
    category: "start",
    kind: "report",
    messageKey: "營運總覽",
    permissions: ["VIEW_REPORTS", "MANAGE_STALL"],
    href: organizationHref("/merchant/dashboard"),
  },
  {
    id: "manage-stalls",
    category: "start",
    kind: "configure",
    messageKey: "管理攤位",
    permissions: ["MANAGE_STALL"],
    href: organizationHref("/merchant/stalls"),
  },
  {
    id: "merchant-profile",
    category: "start",
    kind: "configure",
    messageKey: "商家資料",
    permissions: ["MANAGE_ORGANIZATION"],
    href: organizationHref("/merchant/organization"),
  },
  {
    id: "stall-basic",
    category: "start",
    kind: "configure",
    messageKey: "基本資料",
    permissions: ["MANAGE_STALL"],
    requiresStall: true,
    href: stallHref("/settings/basic"),
  },
  {
    id: "stall-status",
    category: "start",
    kind: "configure",
    messageKey: "營運狀態",
    permissions: ["MANAGE_STALL", "MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/operations"),
  },
  {
    id: "stall-operations",
    category: "operations",
    kind: "operate",
    customTitle: "stallOperations",
    permissions: ["VIEW_ORDERS", "MANAGE_STALL"],
    requiresStall: true,
    href: (scope) => `/merchant/${encodeURIComponent(scope.stall?.slug ?? "")}`,
  },
  {
    id: "staff-pos",
    category: "ordering",
    kind: "operate",
    customTitle: "staffPos",
    permissions: ["CREATE_ORDERS"],
    requiresStall: true,
    href: (scope) => `/staff/${encodeURIComponent(scope.stall?.slug ?? "")}`,
  },
  {
    id: "online-ordering",
    category: "ordering",
    kind: "configure",
    messageKey: "線上點餐與預約",
    permissions: ["MANAGE_ORDERING"],
    requiresStall: true,
    note: "availability",
    href: stallHref("/settings/online-ordering"),
  },
  {
    id: "business-hours",
    category: "ordering",
    kind: "configure",
    messageKey: "營業時間",
    permissions: ["MANAGE_STALL", "MANAGE_ORDERING"],
    requiresStall: true,
    note: "availability",
    href: stallHref("/settings/business-hours"),
  },
  {
    id: "special-hours",
    category: "ordering",
    kind: "configure",
    messageKey: "特殊營業日與公休公告",
    permissions: ["MANAGE_STALL", "MANAGE_ORDERING"],
    requiresStall: true,
    note: "specialHours",
    href: stallHref("/settings/special-hours"),
  },
  {
    id: "dine-in",
    category: "ordering",
    kind: "configure",
    messageKey: "內用點餐",
    permissions: ["MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/dine-in"),
  },
  {
    id: "dining-tables",
    category: "ordering",
    kind: "configure",
    messageKey: "內用桌位與專屬 QR",
    permissions: ["MANAGE_STALL", "MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/dining-tables"),
  },
  {
    id: "staff-delivery",
    category: "ordering",
    kind: "configure",
    messageKey: "店員外送點餐",
    permissions: ["MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/staff-delivery"),
  },
  {
    id: "stall-payment-options",
    category: "ordering",
    kind: "configure",
    messageKey: "付款方式",
    permissions: ["MANAGE_ORDERING", "MANAGE_STALL"],
    requiresStall: true,
    href: stallHref("/settings/payments"),
  },
  {
    id: "discounts",
    category: "ordering",
    kind: "configure",
    messageKey: "結帳折扣",
    permissions: ["APPROVE_DISCOUNT", "MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/discounts"),
  },
  {
    id: "lottery",
    category: "ordering",
    kind: "configure",
    messageKey: "抽抽樂推薦",
    permissions: ["MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/lottery"),
  },
  {
    id: "order-limits",
    category: "ordering",
    kind: "security",
    messageKey: "安全與訂單限制",
    permissions: ["MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/order-limits"),
  },
  {
    id: "qr-print",
    category: "ordering",
    kind: "configure",
    customTitle: "qrPrint",
    permissions: ["MANAGE_STALL", "MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/qr-print"),
  },
  {
    id: "shared-catalog",
    category: "catalog",
    kind: "configure",
    messageKey: "共用商品",
    permissions: ["MANAGE_SHARED_PRODUCTS"],
    href: organizationHref("/merchant/catalog"),
  },
  {
    id: "stall-products",
    category: "catalog",
    kind: "configure",
    messageKey: "攤位商品設定",
    permissions: ["MANAGE_PRODUCTS"],
    requiresStall: true,
    note: "productVisibility",
    href: stallHref("/products"),
  },
  {
    id: "catalog-localization",
    category: "catalog",
    kind: "configure",
    messageKey: "翻譯完整度",
    permissions: ["MANAGE_ORGANIZATION", "MANAGE_SHARED_PRODUCTS"],
    href: organizationHref("/merchant/localization"),
  },
  {
    id: "qr-languages",
    category: "catalog",
    kind: "configure",
    messageKey: "QR 點餐語系",
    permissions: ["MANAGE_STALL", "MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/settings/languages"),
  },
  {
    id: "supply",
    category: "catalog",
    kind: "configure",
    messageKey: "庫存與配方",
    permissions: ["MANAGE_SHARED_PRODUCTS"],
    feature: "supply",
    note: "supply",
    href: organizationHref("/merchant/supply"),
  },
  {
    id: "kitchen-board",
    category: "operations",
    kind: "operate",
    customTitle: "kitchenBoard",
    permissions: ["VIEW_KDS", "UPDATE_PRODUCTION_TASKS"],
    requiresStall: true,
    requiresKds: true,
    note: "kds",
    href: (scope) => `/kitchen?stall=${encodeURIComponent(scope.stall?.slug ?? "")}`,
  },
  {
    id: "kds-module",
    category: "operations",
    kind: "configure",
    messageKey: "廚房 KDS",
    permissions: ["MANAGE_KDS", "MANAGE_ORDERING"],
    requiresStall: true,
    note: "kds",
    href: stallHref("/settings/kds"),
  },
  {
    id: "kds-stations",
    category: "operations",
    kind: "configure",
    messageKey: "KDS 工作站",
    permissions: ["MANAGE_KDS"],
    requiresStall: true,
    requiresKds: true,
    href: stallHref("/kitchen/stations"),
  },
  {
    id: "kds-settings",
    category: "operations",
    kind: "configure",
    messageKey: "KDS 設定",
    permissions: ["MANAGE_KDS"],
    requiresStall: true,
    requiresKds: true,
    href: stallHref("/kitchen/settings"),
  },
  {
    id: "printing",
    category: "operations",
    kind: "integration",
    messageKey: "訂單列印",
    permissions: ["MANAGE_PRINT_QUEUE", "MANAGE_ORDERING"],
    requiresStall: true,
    note: "printing",
    href: stallHref("/settings/printing"),
  },
  {
    id: "print-queue",
    category: "operations",
    kind: "operate",
    customTitle: "printQueue",
    permissions: ["MANAGE_PRINT_QUEUE"],
    requiresStall: true,
    note: "printing",
    href: (scope) => `/staff/${encodeURIComponent(scope.stall?.slug ?? "")}/print`,
  },
  {
    id: "cash-shift",
    category: "operations",
    kind: "operate",
    messageKey: "現金交班",
    permissions: ["VIEW_CASH_SHIFT", "MANAGE_CASH_SHIFT"],
    requiresStall: true,
    note: "cashShift",
    href: (scope) => `/staff/${encodeURIComponent(scope.stall?.slug ?? "")}/cash`,
  },
  {
    id: "pickup-display",
    category: "operations",
    kind: "configure",
    messageKey: "CDS 取餐顯示",
    permissions: ["MANAGE_CDS"],
    requiresStall: true,
    href: stallHref("/display"),
  },
  {
    id: "capacity",
    category: "operations",
    kind: "configure",
    messageKey: "產能與等候時間",
    permissions: ["MANAGE_CAPACITY", "OPERATE_CAPACITY"],
    requiresStall: true,
    href: stallHref("/capacity"),
  },
  {
    id: "locations",
    category: "operations",
    kind: "configure",
    messageKey: "常用地點",
    permissions: ["MANAGE_STALL_LOCATIONS"],
    requiresStall: true,
    href: stallHref("/locations"),
  },
  {
    id: "stall-schedule",
    category: "operations",
    kind: "configure",
    messageKey: "出攤行程",
    permissions: ["MANAGE_STALL_SCHEDULES"],
    requiresStall: true,
    href: stallHref("/schedule"),
  },
  {
    id: "line-notifications",
    category: "operations",
    kind: "integration",
    messageKey: "LINE 通知",
    permissions: ["MANAGE_LINE_INTEGRATION"],
    requiresStall: true,
    note: "integration",
    href: stallHref("/line"),
  },
  {
    id: "offline-device",
    category: "operations",
    kind: "security",
    messageKey: "離線裝置",
    permissions: ["MANAGE_STALL", "MANAGE_ORDERING"],
    requiresStall: true,
    href: stallHref("/offline"),
  },
  {
    id: "report-overview",
    category: "reports",
    kind: "report",
    customTitle: "reportOverview",
    permissions: ["VIEW_REPORTS"],
    href: organizationHref("/merchant/reports/overview"),
  },
  {
    id: "report-orders",
    category: "reports",
    kind: "report",
    customTitle: "reportOrders",
    permissions: ["VIEW_REPORTS"],
    href: organizationHref("/merchant/reports/orders"),
  },
  {
    id: "report-stalls",
    category: "reports",
    kind: "report",
    customTitle: "reportStalls",
    permissions: ["VIEW_REPORTS"],
    multiStallOnly: true,
    href: organizationHref("/merchant/reports/stalls"),
  },
  {
    id: "report-products",
    category: "reports",
    kind: "report",
    customTitle: "reportProducts",
    permissions: ["VIEW_REPORTS"],
    href: organizationHref("/merchant/reports/products"),
  },
  {
    id: "report-payments",
    category: "reports",
    kind: "report",
    customTitle: "reportPayments",
    permissions: ["VIEW_REPORTS"],
    href: organizationHref("/merchant/reports/payments"),
  },
  {
    id: "report-cash-shifts",
    category: "reports",
    kind: "report",
    messageKey: "現金交班",
    permissions: ["VIEW_CASH_SHIFT", "VIEW_REPORTS"],
    href: organizationHref("/merchant/reports/cash-shifts"),
  },
  {
    id: "operating-profit",
    category: "reports",
    kind: "report",
    messageKey: "營業損益與成本",
    permissions: ["VIEW_REPORTS"],
    href: organizationHref("/merchant/operating-profit"),
  },
  {
    id: "report-schedules",
    category: "reports",
    kind: "configure",
    messageKey: "排程寄送",
    permissions: ["MANAGE_REPORT_SCHEDULES"],
    href: organizationHref("/merchant/report-schedules"),
  },
  {
    id: "team",
    category: "people",
    kind: "security",
    messageKey: "團隊與權限",
    permissions: ["MANAGE_STAFF"],
    href: organizationHref("/merchant/team"),
  },
  {
    id: "stall-members",
    category: "people",
    kind: "security",
    messageKey: "攤位成員",
    permissions: ["MANAGE_STAFF", "MANAGE_STALL"],
    requiresStall: true,
    href: stallHref("/settings/members"),
  },
  {
    id: "workforce",
    category: "people",
    kind: "configure",
    messageKey: "員工排班與薪資",
    permissions: ["MANAGE_ATTENDANCE"],
    href: organizationHref("/merchant/workforce"),
  },
  {
    id: "attendance",
    category: "people",
    kind: "operate",
    messageKey: "員工定位打卡",
    permissions: ["MANAGE_ATTENDANCE"],
    requiresStall: true,
    note: "attendance",
    href: stallHref("/attendance"),
  },
  {
    id: "growth",
    category: "growth",
    kind: "configure",
    messageKey: "會員與成長",
    permissions: ["MANAGE_ORGANIZATION"],
    feature: "growth",
    href: organizationHref("/merchant/growth"),
  },
  {
    id: "market-events",
    category: "growth",
    kind: "configure",
    messageKey: "市集活動",
    permissions: ["MANAGE_MARKET_EVENTS"],
    multiStallOnly: true,
    href: organizationHref("/merchant/events"),
  },
  {
    id: "integration-center",
    category: "growth",
    kind: "integration",
    messageKey: "整合設定中心",
    permissions: [
      "MANAGE_ORGANIZATION",
      "MANAGE_DELIVERY_INTEGRATIONS",
      "MANAGE_PAYMENT_INTEGRATIONS",
      "MANAGE_LINE_INTEGRATION",
    ],
    note: "integration",
    href: organizationHref("/merchant/integrations"),
  },
  {
    id: "delivery-integrations",
    category: "growth",
    kind: "integration",
    messageKey: "外送平台整合",
    permissions: ["MANAGE_DELIVERY_INTEGRATIONS"],
    requiresStall: true,
    note: "integration",
    href: (scope) => `/merchant/integrations/delivery?stallId=${encodeURIComponent(scope.stall?.id ?? "")}`,
  },
  {
    id: "payment-integrations",
    category: "growth",
    kind: "integration",
    messageKey: "付款與金流",
    permissions: ["MANAGE_PAYMENT_INTEGRATIONS"],
    feature: "payments",
    note: "integration",
    href: organizationHref("/merchant/payments"),
  },
  {
    id: "billing",
    category: "growth",
    kind: "report",
    messageKey: "訂閱與帳務",
    permissions: ["VIEW_BILLING"],
    feature: "billing",
    href: organizationHref("/merchant/billing"),
  },
  {
    id: "audit-and-alerts",
    category: "security",
    kind: "security",
    messageKey: "稽核與營運警示",
    permissions: ["VIEW_AUDIT_LOGS", "MANAGE_OPERATIONAL_ALERTS"],
    href: organizationHref("/merchant/operations"),
  },
  {
    id: "account-security",
    category: "security",
    kind: "security",
    messageKey: "帳號與安全性",
    note: "accountSecurity",
    href: () => "/merchant/account/security",
  },
] as const satisfies readonly MerchantGuideItem[];

export const merchantGuideItems: readonly MerchantGuideItem[] = guideItems;

export function getVisibleMerchantGuideItems(scope: MerchantGuideScope) {
  const roles = [...new Set([
    ...scope.roles,
    ...(scope.stall?.roles ?? []),
  ])];

  return merchantGuideItems.filter((item) => {
    if (item.permissions && !item.permissions.some((permission) => (
      roles.some((role) => hasPermission(role, permission))
    ))) return false;
    if (item.feature && !scope.features[item.feature]) return false;
    if (item.requiresStall && !scope.stall) return false;
    if (item.requiresKds && !scope.stall?.kdsEnabled) return false;
    if (item.multiStallOnly && scope.operatingMode !== "MULTI_STALL") return false;
    if (item.setupInProgressOnly && scope.merchantSetupState !== "IN_PROGRESS") return false;
    return true;
  });
}

export function resolveMerchantGuideHref(item: MerchantGuideItem, scope: MerchantGuideScope) {
  return item.href(scope);
}

export function findCurrentMerchantGuideItem(
  items: readonly MerchantGuideItem[],
  scope: MerchantGuideScope,
  pathname: string,
) {
  return [...items]
    .map((item) => ({ item, path: item.href(scope).split("?")[0] }))
    .filter(({ path }) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0]?.item ?? null;
}
