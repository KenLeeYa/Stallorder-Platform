import type { PaymentConnectionMode, PaymentProviderCode } from "./types";

export type PaymentProviderDefinition = {
  provider: PaymentProviderCode;
  label: string;
  connectionMode: PaymentConnectionMode;
  repositorySupport: "COMPLETE" | "CONTRACT_ONLY" | "MANUAL";
  mockSupport: boolean;
  sandboxSupport: "AVAILABLE_AFTER_ONBOARDING" | "REQUIRES_DOCUMENTATION" | "NOT_APPLICABLE";
  liveBlocker: string | null;
  capabilities: string[];
};

export const paymentProviderDefinitions: readonly PaymentProviderDefinition[] = [
  { provider: "CASH_MANUAL", label: "現金／人工付款", connectionMode: "MANUAL", repositorySupport: "MANUAL", mockSupport: true, sandboxSupport: "NOT_APPLICABLE", liveBlocker: null, capabilities: ["MANUAL_CONFIRMATION"] },
  { provider: "LINE_PAY", label: "LINE Pay", connectionMode: "DIRECT", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "AVAILABLE_AFTER_ONBOARDING", liveBlocker: "LINE_PAY_SIGNED_TRANSPORT_AND_SANDBOX_E2E_REQUIRED", capabilities: ["REDIRECT", "QUERY", "REFUND", "RECONCILIATION"] },
  { provider: "JKO_PAY", label: "街口支付", connectionMode: "DIRECT", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "REQUIRES_PROVIDER_DOCUMENTATION", capabilities: ["QR_OR_REDIRECT", "QUERY", "REFUND", "RECONCILIATION"] },
  { provider: "TWQR", label: "TWQR", connectionMode: "TWQR", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "AVAILABLE_AFTER_ONBOARDING", liveBlocker: "ACQUIRER_CONTRACT_AND_WALLET_CAPABILITIES_REQUIRED", capabilities: ["DYNAMIC_QR", "STATIC_QR_METADATA", "QUERY", "RECONCILIATION"] },
  { provider: "TAIWAN_PAY", label: "台灣 Pay", connectionMode: "TWQR", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "ACQUIRER_CAPABILITY_CONFIRMATION_REQUIRED", capabilities: ["TWQR_CAPABILITY", "QUERY", "RECONCILIATION"] },
  { provider: "PX_PAY_PLUS", label: "全支付", connectionMode: "DIRECT", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "REQUIRES_PROVIDER_DOCUMENTATION", capabilities: ["QR_OR_REDIRECT", "QUERY", "REFUND", "RECONCILIATION"] },
  { provider: "IPASS_MONEY", label: "iPASS MONEY", connectionMode: "TWQR", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "ACQUIRER_CAPABILITY_CONFIRMATION_REQUIRED", capabilities: ["WALLET_CAPABILITY"] },
  { provider: "ICASH_PAY", label: "icash Pay", connectionMode: "TWQR", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "ACQUIRER_CAPABILITY_CONFIRMATION_REQUIRED", capabilities: ["WALLET_CAPABILITY"] },
  { provider: "PLUS_PAY", label: "全盈+PAY", connectionMode: "TWQR", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "ACQUIRER_CAPABILITY_CONFIRMATION_REQUIRED", capabilities: ["WALLET_CAPABILITY"] },
  { provider: "EASY_WALLET", label: "悠遊付", connectionMode: "TWQR", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "ACQUIRER_CAPABILITY_CONFIRMATION_REQUIRED", capabilities: ["WALLET_CAPABILITY"] },
  { provider: "GAMA_PAY", label: "橘子支付", connectionMode: "GATEWAY", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "GATEWAY_OR_PROVIDER_CONTRACT_REQUIRED", capabilities: ["WALLET_CAPABILITY"] },
  { provider: "OPAY", label: "歐付寶", connectionMode: "GATEWAY", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "GATEWAY_OR_PROVIDER_CONTRACT_REQUIRED", capabilities: ["WALLET_CAPABILITY"] },
  { provider: "PAYMENT_GATEWAY", label: "付款閘道", connectionMode: "GATEWAY", repositorySupport: "CONTRACT_ONLY", mockSupport: true, sandboxSupport: "REQUIRES_DOCUMENTATION", liveBlocker: "GATEWAY_SELECTION_AND_HOSTED_TOKENIZATION_REQUIRED", capabilities: ["CREDIT_CARD", "APPLE_PAY", "GOOGLE_PAY", "HOSTED_TOKENIZATION"] },
] as const;

export function getPaymentProviderDefinition(provider: PaymentProviderCode) {
  return paymentProviderDefinitions.find((definition) => definition.provider === provider)!;
}
