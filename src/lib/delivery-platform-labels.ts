export const deliveryConnectionStatusLabels: Record<string, string> = {
  DRAFT: "尚未申請",
  PENDING_AUTHORIZATION: "等待授權",
  PENDING_PARTNER_APPROVAL: "等待外送平台審核",
  PENDING_STORE_MAPPING: "等待門市對應",
  CONFIGURING: "設定中",
  TESTING: "測試中",
  ACTIVE: "已啟用",
  PAUSED: "已暫停",
  ERROR: "發生錯誤",
  DISCONNECTED: "已解除連線",
  REJECTED: "已拒絕",
};

export const deliveryRequestStatusLabels: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "等待平台審核",
  NEEDS_INFORMATION: "等待補件",
  APPROVED_FOR_CONFIGURATION: "已核准設定",
  REJECTED: "已拒絕",
  CANCELLED: "已取消",
  COMPLETED: "已完成",
};

export const deliveryProcessingStatusLabels: Record<string, string> = {
  RECEIVED: "已接收",
  VALIDATING: "驗證中",
  MAPPING_REQUIRED: "需要完成對應",
  READY_FOR_IMPORT: "等待匯入",
  IMPORTED: "已匯入",
  WAITING_PROVIDER_CONFIRMATION: "等待平台確認",
  CONFIRMED: "已確認",
  REJECTED: "已拒絕",
  FAILED: "處理失敗",
  CANCELLED: "已取消",
};

export function deliveryProviderLabel(provider: string) {
  if (provider === "UBER_EATS") return "Uber Eats";
  if (provider === "FOODPANDA") return "foodpanda";
  if (provider === "MOCK") return "Mock 測試平台";
  return provider;
}
