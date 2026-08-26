import "server-only";

import { prisma } from "@/lib/prisma";

export const integrationLifecycleStatuses = [
  "NOT_CONFIGURED",
  "CONFIGURED",
  "VALIDATING",
  "SANDBOX_READY",
  "PILOT_READY",
  "PRODUCTION_READY",
  "DEGRADED",
  "DISABLED",
  "ERROR",
] as const;

export type IntegrationLifecycleStatus = (typeof integrationLifecycleStatuses)[number];

export type IntegrationSetupDefinition = {
  code: string;
  category: "IDENTITY" | "MESSAGING" | "PAYMENT" | "COMMERCE" | "OPERATIONS" | "DEVELOPER";
  label: string;
  description: string;
  capabilities: readonly string[];
  setupPath: string | null;
  architecture: "READY" | "FOUNDATION" | "PLANNED";
  manualApprovalRequired: boolean;
};

export const integrationSetupCatalog: readonly IntegrationSetupDefinition[] = [
  { code: "AUTHENTICATION", category: "IDENTITY", label: "登入與身分驗證", description: "商家 OAuth、Passkey 與安全工作階段。", capabilities: ["Google", "LINE", "Apple", "Microsoft", "Passkey"], setupPath: "/merchant/account/security", architecture: "READY", manualApprovalRequired: true },
  { code: "LINE_LOGIN", category: "IDENTITY", label: "LINE Login", description: "顧客或商家身分連結；與官方帳號憑證分離。", capabilities: ["OAuth", "身分連結", "撤銷"], setupPath: "/merchant/account/security", architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "LINE_OFFICIAL_ACCOUNT", category: "MESSAGING", label: "LINE 官方帳號", description: "攤位官方帳號連線與訊息入口。", capabilities: ["官方帳號", "攤位指派"], setupPath: "/merchant/stalls", architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "LINE_MESSAGING", category: "MESSAGING", label: "LINE Messaging", description: "訂單狀態通知與顧客同意管理。", capabilities: ["訊息模板", "防重送", "同意撤回"], setupPath: "/merchant/stalls", architecture: "READY", manualApprovalRequired: true },
  { code: "LINE_PAY", category: "PAYMENT", label: "LINE Pay", description: "線上付款 Provider；未驗證前維持關閉。", capabilities: ["付款", "退款", "Webhook"], setupPath: "/merchant/payments", architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "JKO_PAY", category: "PAYMENT", label: "街口支付", description: "台灣行動支付 Provider 預留。", capabilities: ["付款", "退款"], setupPath: "/merchant/payments", architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "PX_PAY_PLUS", category: "PAYMENT", label: "全支付", description: "台灣行動支付 Provider 預留。", capabilities: ["付款", "退款"], setupPath: "/merchant/payments", architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "TAIWAN_PAY", category: "PAYMENT", label: "台灣 Pay", description: "台灣 Pay Provider 預留。", capabilities: ["付款", "退款"], setupPath: "/merchant/payments", architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "CREDIT_CARD_PROVIDER", category: "PAYMENT", label: "信用卡金流服務", description: "不綁定單一供應商的信用卡聚合介面。", capabilities: ["授權", "請款", "部分退款", "對帳"], setupPath: "/merchant/payments", architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "E_INVOICE", category: "PAYMENT", label: "電子發票", description: "開立、作廢、折讓、查詢與補發的安全介面。", capabilities: ["開立", "作廢", "折讓", "對帳"], setupPath: null, architecture: "FOUNDATION", manualApprovalRequired: true },
  { code: "FOODPANDA", category: "COMMERCE", label: "foodpanda", description: "店舖、菜單、訂單 Webhook 與對帳。", capabilities: ["店舖", "菜單", "訂單", "對帳"], setupPath: "/merchant/integrations/delivery", architecture: "READY", manualApprovalRequired: true },
  { code: "UBER_EATS", category: "COMMERCE", label: "Uber Eats", description: "店舖、菜單、訂單 Webhook 與對帳。", capabilities: ["店舖", "菜單", "訂單", "對帳"], setupPath: "/merchant/integrations/delivery", architecture: "READY", manualApprovalRequired: true },
  { code: "LOGISTICS", category: "COMMERCE", label: "物流／外送派遣", description: "未來物流與派遣 Adapter 的統一入口。", capabilities: ["報價", "派遣", "追蹤"], setupPath: null, architecture: "PLANNED", manualApprovalRequired: true },
  { code: "ERP_ACCOUNTING", category: "OPERATIONS", label: "ERP／會計匯出", description: "CSV、日結與庫存調整的穩定交換契約。", capabilities: ["CSV", "日結匯出", "Dry run"], setupPath: null, architecture: "PLANNED", manualApprovalRequired: false },
  { code: "OUTBOUND_WEBHOOK", category: "DEVELOPER", label: "對外 Webhook", description: "HMAC 簽章、重試、停用與重播。", capabilities: ["事件訂閱", "HMAC", "重試"], setupPath: "/merchant/developer", architecture: "FOUNDATION", manualApprovalRequired: false },
  { code: "PUBLIC_API_KEYS", category: "DEVELOPER", label: "公開 API 金鑰", description: "Organization／Stall scope、輪替、到期與稽核。", capabilities: ["Scoped key", "輪替", "Rate limit"], setupPath: "/merchant/developer", architecture: "FOUNDATION", manualApprovalRequired: false },
  { code: "PRINTING", category: "OPERATIONS", label: "列印中心", description: "系統列印、CloudPRNT 與 WebPRNT 路由。", capabilities: ["路由規則", "重印", "失敗重試"], setupPath: "/merchant/stalls", architecture: "READY", manualApprovalRequired: false },
] as const;

const statusRank: Record<IntegrationLifecycleStatus, number> = {
  NOT_CONFIGURED: 0,
  DISABLED: 1,
  ERROR: 2,
  DEGRADED: 3,
  VALIDATING: 4,
  CONFIGURED: 5,
  SANDBOX_READY: 6,
  PILOT_READY: 7,
  PRODUCTION_READY: 8,
};

export function normalizeIntegrationStatus(value: string | null | undefined): IntegrationLifecycleStatus {
  switch (value?.trim().toUpperCase()) {
    case "ACTIVE":
    case "CONNECTED":
    case "CONFIGURED":
    case "APPROVED":
      return "CONFIGURED";
    case "VALIDATING":
    case "PENDING_VALIDATION":
      return "VALIDATING";
    case "READY":
    case "SANDBOX_READY":
    case "MOCK_VERIFIED":
    case "CONTRACT_VERIFIED":
      return "SANDBOX_READY";
    case "PILOT":
    case "PILOT_READY":
    case "PILOT_VERIFIED":
      return "PILOT_READY";
    case "PRODUCTION_READY":
    case "PRODUCTION_VERIFIED":
    case "ACTIVE_PRODUCTION":
      return "PRODUCTION_READY";
    case "DEGRADED":
    case "PAUSED":
      return "DEGRADED";
    case "DISABLED":
      return "DISABLED";
    case "ERROR":
    case "FAILED":
      return "ERROR";
    default:
      return "NOT_CONFIGURED";
  }
}

export function resolveBestConnectionStatus(values: readonly string[]) {
  return values
    .map(normalizeIntegrationStatus)
    .reduce<IntegrationLifecycleStatus>((best, status) => (
      statusRank[status] > statusRank[best] ? status : best
    ), "NOT_CONFIGURED");
}

type ConnectionSnapshot = {
  code: string;
  statuses: string[];
  lastSuccessfulAt: Date | null;
  lastErrorCode: string | null;
};

function snapshot(code: string): ConnectionSnapshot {
  return { code, statuses: [], lastSuccessfulAt: null, lastErrorCode: null };
}

export async function getIntegrationSetupCenterData(organizationId: string) {
  const [notifications, payments, delivery, printers, apiClients, webhookEndpoints] = await Promise.all([
    prisma.notificationIntegration.findMany({
      where: { organizationId },
      select: { provider: true, status: true, updatedAt: true },
    }),
    prisma.paymentProviderConnection.findMany({
      where: { organizationId },
      select: { provider: true, status: true, lastVerifiedAt: true, lastErrorCode: true },
    }),
    prisma.deliveryPlatformConnection.findMany({
      where: { organizationId },
      select: { provider: true, status: true, lastSuccessfulSyncAt: true, lastErrorCode: true },
    }),
    prisma.printer.findMany({
      where: { organizationId },
      select: { isEnabled: true, lastSeenAt: true },
    }),
    prisma.publicApiClient.findMany({
      where: { organizationId },
      select: { status: true, lastUsedAt: true },
    }),
    prisma.outboundWebhookEndpoint.findMany({
      where: { organizationId },
      select: { status: true, lastSuccessfulAt: true, lastErrorCode: true },
    }),
  ]);

  const byCode = new Map(integrationSetupCatalog.map((entry) => [entry.code, snapshot(entry.code)]));
  const append = (code: string, status: string, successAt: Date | null, errorCode: string | null) => {
    const item = byCode.get(code);
    if (!item) return;
    item.statuses.push(status);
    if (successAt && (!item.lastSuccessfulAt || successAt > item.lastSuccessfulAt)) item.lastSuccessfulAt = successAt;
    if (errorCode) item.lastErrorCode = errorCode;
  };

  for (const connection of notifications) {
    if (connection.provider === "LINE") {
      append("LINE_OFFICIAL_ACCOUNT", connection.status, connection.updatedAt, null);
      append("LINE_MESSAGING", connection.status, connection.updatedAt, null);
    }
  }
  for (const connection of payments) {
    const provider = connection.provider.toUpperCase();
    const code = provider === "CREDIT_CARD_AGGREGATOR" ? "CREDIT_CARD_PROVIDER" : provider;
    append(code, connection.status, connection.lastVerifiedAt, connection.lastErrorCode);
  }
  for (const connection of delivery) {
    append(
      connection.provider.toUpperCase().replaceAll(" ", "_"),
      connection.status,
      connection.lastSuccessfulSyncAt,
      connection.lastErrorCode,
    );
  }
  for (const printer of printers) {
    append("PRINTING", printer.isEnabled ? "CONFIGURED" : "DISABLED", printer.lastSeenAt, null);
  }
  for (const client of apiClients) {
    append("PUBLIC_API_KEYS", client.status, client.lastUsedAt, null);
  }
  for (const endpoint of webhookEndpoints) {
    append("OUTBOUND_WEBHOOK", endpoint.status, endpoint.lastSuccessfulAt, endpoint.lastErrorCode);
  }

  return integrationSetupCatalog.map((definition) => {
    const state = byCode.get(definition.code) ?? snapshot(definition.code);
    return {
      ...definition,
      status: resolveBestConnectionStatus(state.statuses),
      connectionCount: state.statuses.length,
      lastSuccessfulAt: state.lastSuccessfulAt?.toISOString() ?? null,
      lastErrorCode: state.lastErrorCode,
    };
  });
}
