import type { PrintTicketPayload } from "@/lib/kitchen-print-ticket";

export const MAX_PRINT_RULES_PER_STALL = 50;

export type PrinterConnectionType = "WEBPRNT_BLUETOOTH" | "CLOUDPRNT" | "SYSTEM_PRINT";
export type PrintDocumentType = "KITCHEN_TICKET" | "CUSTOMER_RECEIPT";
export type PrintTrigger = "ORDER_CONFIRMED" | "PAYMENT_COMPLETED";
export type PrintSplitMode = "NONE" | "CATEGORY" | "PRODUCT" | "ITEM";
export type PrintOrderSource = "QR_MENU" | "STAFF_POS" | "LINE_DELIVERY" | "OFFLINE_POS";
export type PrintOrderOrigin = "ONLINE_QR" | "ONLINE_STAFF" | "OFFLINE_POS" | "IMPORTED";
export type PrintFulfillmentType = "TAKEOUT" | "DINE_IN" | "DELIVERY";

export type PrinterView = {
  id: string;
  name: string;
  connectionType: PrinterConnectionType;
  model: string;
  paperWidthMm: number;
  autoDetectEnabled: boolean;
  openCashDrawerOnCashPayment: boolean;
  isEnabled: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  deviceId: string | null;
  hasCloudPrntCredentials: boolean;
  cloudPrntServerUrl: string | null;
};

export type PrintRuleDraft = {
  name: string;
  printerId: string;
  isEnabled: boolean;
  documentType: PrintDocumentType;
  trigger: PrintTrigger;
  orderSources: PrintOrderSource[];
  orderOrigins: PrintOrderOrigin[];
  fulfillmentTypes: PrintFulfillmentType[];
  productCategoryIds: string[];
  productGroupIds: string[];
  copies: number;
  fontScale: number;
  splitMode: PrintSplitMode;
  aggregateItems: boolean;
  autoPrint: boolean;
  showCustomerName: boolean;
  showCustomerPhone: boolean;
  showDeliveryAddress: boolean;
  showOrderNote: boolean;
  showItemNotes: boolean;
  showPrices: boolean;
  showPaymentMethod: boolean;
  feedLines: number;
  sortOrder: number;
};

export type PrintRuleView = PrintRuleDraft & {
  id: string;
  printer: { id: string; name: string; isEnabled: boolean };
};

export function printRuleDraftFromView(rule: PrintRuleView): PrintRuleDraft {
  return {
    name: rule.name,
    printerId: rule.printerId,
    isEnabled: rule.isEnabled,
    documentType: rule.documentType,
    trigger: rule.trigger,
    orderSources: [...rule.orderSources],
    orderOrigins: [...rule.orderOrigins],
    fulfillmentTypes: [...rule.fulfillmentTypes],
    productCategoryIds: [...rule.productCategoryIds],
    productGroupIds: [...rule.productGroupIds],
    copies: rule.copies,
    fontScale: rule.fontScale,
    splitMode: rule.splitMode,
    aggregateItems: rule.aggregateItems,
    autoPrint: rule.autoPrint,
    showCustomerName: rule.showCustomerName,
    showCustomerPhone: rule.showCustomerPhone,
    showDeliveryAddress: rule.showDeliveryAddress,
    showOrderNote: rule.showOrderNote,
    showItemNotes: rule.showItemNotes,
    showPrices: rule.showPrices,
    showPaymentMethod: rule.showPaymentMethod,
    feedLines: rule.feedLines,
    sortOrder: rule.sortOrder,
  };
}

export type PrintJobView = {
  id: string;
  documentType: PrintDocumentType;
  status: "PENDING" | "PRINTING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  queuedAt: string;
  printedAt: string | null;
  reprintOfId: string | null;
  isRoutingCopy: boolean;
  printer: {
    id: string;
    name: string;
    connectionType: PrinterConnectionType;
  } | null;
  printRule: { id: string; name: string; autoPrint: boolean } | null;
  order: {
    id: string;
    orderNo: string;
    customerName: string;
    customerPhone: string | null;
    deliveryAddress: string | null;
    tableLabel: string | null;
    fulfillmentType: PrintFulfillmentType;
    total: number;
    createdAt: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      note: string | null;
      noteOptions: Array<{ groupName: string; optionName: string }>;
    }>;
  };
};

export type PrintQueueState = {
  printModuleEnabled: boolean;
  printers: PrinterView[];
  rules: PrintRuleView[];
  catalog: Array<{
    id: string;
    name: string;
    groups: Array<{ id: string; name: string }>;
  }>;
  jobs: PrintJobView[];
};

export type CloudPrntSetup = {
  serverUrl: string;
  deviceId: string;
  deviceToken: string;
  pollingIntervalSeconds: 5;
  responseTimeoutSeconds: 60;
};

export type PrintQueueCommandResponse = {
  state: PrintQueueState;
  entityId?: string;
  printPayload?: PrintTicketPayload;
  cloudPrntSetup?: CloudPrntSetup;
};

export type RunPrintQueueCommand = (
  command: Record<string, unknown>,
  successMessage?: string,
) => Promise<PrintQueueCommandResponse | null>;
