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
  isEnabled: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
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
  sortOrder: number;
};

export type PrintRuleView = PrintRuleDraft & {
  id: string;
  printer: { id: string; name: string; isEnabled: boolean };
};

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

export type PrintQueueCommandResponse = {
  state: PrintQueueState;
  entityId?: string;
  printPayload?: PrintTicketPayload;
};

export type RunPrintQueueCommand = (
  command: Record<string, unknown>,
  successMessage?: string,
) => Promise<PrintQueueCommandResponse | null>;
