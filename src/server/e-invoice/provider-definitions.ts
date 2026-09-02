import type { InvoiceProviderCapabilities, InvoiceProviderCode } from "./e-invoice-provider";

const mockCapabilities: InvoiceProviderCapabilities = {
  b2cIssue: true,
  b2bIssue: true,
  query: true,
  void: true,
  allowance: true,
  allowanceVoid: true,
  mobileBarcode: true,
  citizenDigitalCertificate: false,
  memberCarrier: true,
  donationCode: true,
  paperProof: true,
  emailNotification: false,
  smsNotification: false,
  offlineIssue: false,
  invoiceTrackManagement: false,
  batchIssue: false,
  webhook: false,
  reconciliation: true,
  sandbox: true,
};

export type InvoiceProviderDefinition = {
  provider: InvoiceProviderCode;
  label: string;
  contractStatus: "OFFICIAL_DOCS_LOCATED" | "OFFICIAL_DOWNLOAD_REQUIRED" | "CONTRACT_NOT_VERIFIED" | "DISABLED";
  officialDocumentation: readonly string[];
  allowedHosts: Readonly<{ sandbox: readonly string[]; production: readonly string[] }>;
  mockCapabilities: Readonly<InvoiceProviderCapabilities>;
  liveCapabilities: Readonly<InvoiceProviderCapabilities>;
  liveBlocker: string;
};

const noCapabilities: InvoiceProviderCapabilities = Object.fromEntries(
  Object.keys(mockCapabilities).map((key) => [key, false]),
) as InvoiceProviderCapabilities;

export const invoiceProviderDefinitions: readonly InvoiceProviderDefinition[] = [
  {
    provider: "ECPAY",
    label: "綠界 ECPay",
    contractStatus: "OFFICIAL_DOCS_LOCATED",
    officialDocumentation: [
      "https://developers.ecpay.com.tw/",
      "https://developers.ecpay.com.tw/14850/",
    ],
    allowedHosts: {
      sandbox: ["einvoice-stage.ecpay.com.tw"],
      production: ["einvoice.ecpay.com.tw"],
    },
    mockCapabilities,
    liveCapabilities: noCapabilities,
    liveBlocker: "ECPAY_EINVOICE_CONTRACT_NOT_VERIFIED",
  },
  {
    provider: "EZPAY",
    label: "ezPay 電子發票",
    contractStatus: "OFFICIAL_DOWNLOAD_REQUIRED",
    officialDocumentation: [
      "https://inv.ezpay.com.tw/",
      "https://inv.ezpay.com.tw/Invoice_index/download",
    ],
    allowedHosts: { sandbox: [], production: [] },
    mockCapabilities,
    liveCapabilities: noCapabilities,
    liveBlocker: "EZPAY_EINVOICE_CONTRACT_NOT_VERIFIED",
  },
  {
    provider: "TRADEVAN",
    label: "關貿 TradeVan",
    contractStatus: "CONTRACT_NOT_VERIFIED",
    officialDocumentation: ["https://services.tradevan.com.tw/e-commerce/e-invoice/"],
    allowedHosts: { sandbox: [], production: [] },
    mockCapabilities,
    liveCapabilities: noCapabilities,
    liveBlocker: "TRADEVAN_EINVOICE_CONTRACT_NOT_VERIFIED",
  },
  {
    provider: "CUSTOM",
    label: "自訂供應商",
    contractStatus: "DISABLED",
    officialDocumentation: [],
    allowedHosts: { sandbox: [], production: [] },
    mockCapabilities: noCapabilities,
    liveCapabilities: noCapabilities,
    liveBlocker: "CUSTOM_EINVOICE_PROVIDER_DISABLED",
  },
] as const;

export function getInvoiceProviderDefinition(provider: InvoiceProviderCode) {
  return invoiceProviderDefinitions.find((definition) => definition.provider === provider)!;
}
