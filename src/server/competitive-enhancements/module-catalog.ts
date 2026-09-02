export const competitiveModuleCodes = [
  "CORE_OPS",
  "GROWTH",
  "OMNI",
  "HQ",
  "SUPPLY_LITE",
  "EVENT_GROWTH",
  "PUBLIC_API",
  "ADVANCED_ANALYTICS",
] as const;

export type CompetitiveModuleCode = (typeof competitiveModuleCodes)[number];

export type CompetitiveModuleDefinition = {
  code: CompetitiveModuleCode;
  label: string;
  description: string;
  defaultEnabled: boolean;
  risk: "CORE" | "CONTROLLED" | "EXTERNAL";
  setupPath: string;
};

export const competitiveModuleCatalog: readonly CompetitiveModuleDefinition[] = [
  {
    code: "CORE_OPS",
    label: "核心營運",
    description: "QR、店員點餐、訂單、KDS、取餐與既有報表。",
    defaultEnabled: true,
    risk: "CORE",
    setupPath: "/merchant/dashboard",
  },
  {
    code: "GROWTH",
    label: "會員與成長",
    description: "Customer 360、同意、點數、優惠券與規則式自動化。",
    defaultEnabled: false,
    risk: "CONTROLLED",
    setupPath: "/merchant/growth",
  },
  {
    code: "OMNI",
    label: "全通路整合",
    description: "LINE、品牌訂餐、外送平台、金流與電子發票。",
    defaultEnabled: false,
    risk: "EXTERNAL",
    setupPath: "/merchant/integrations",
  },
  {
    code: "HQ",
    label: "總部治理",
    description: "版本化菜單、通路覆寫、審核、發布與回滾。",
    defaultEnabled: false,
    risk: "CONTROLLED",
    setupPath: "/merchant/catalog/versions",
  },
  {
    code: "SUPPLY_LITE",
    label: "原料與庫存管理",
    description: "食材、配方、庫存異動、盤點、耗損與成本快照。",
    defaultEnabled: false,
    risk: "CONTROLLED",
    setupPath: "/merchant/supply",
  },
  {
    code: "EVENT_GROWTH",
    label: "活動成長",
    description: "活動 QR、來源歸因、主辦方聚合報表與估算貢獻。",
    defaultEnabled: false,
    risk: "CONTROLLED",
    setupPath: "/merchant/event-growth",
  },
  {
    code: "PUBLIC_API",
    label: "公開 API",
    description: "Scoped API Key、版本化 API 與簽章 Webhook。",
    defaultEnabled: false,
    risk: "EXTERNAL",
    setupPath: "/merchant/developer",
  },
  {
    code: "ADVANCED_ANALYTICS",
    label: "進階分析",
    description: "跨通路、會員、活動、供應與整合健康指標。",
    defaultEnabled: false,
    risk: "CONTROLLED",
    setupPath: "/merchant/analytics/advanced",
  },
] as const;

export function moduleFlagCode(code: CompetitiveModuleCode) {
  return `MODULE_${code}_ENABLED` as const;
}
