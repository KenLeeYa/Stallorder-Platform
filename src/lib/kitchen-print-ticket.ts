import { z } from "zod";

export const KITCHEN_TICKET_COLUMNS = 32;
export const KITCHEN_TICKET_80MM_COLUMNS = 48;
export const KITCHEN_TICKET_TEMPLATE_VERSION_V1 = "kitchen-58mm-starprnt-v1";
export const KITCHEN_TICKET_TEMPLATE_VERSION = "kitchen-starprnt-v2";
export const CUSTOMER_RECEIPT_TEMPLATE_VERSION = "customer-receipt-starprnt-v1";
export const PRINTER_TEST_TEMPLATE_VERSION = "printer-test-starprnt-v1";
export const KITCHEN_TICKET_MEDIA_TYPE = "application/vnd.star.starprnt";

export type PrintPaperWidth = 58 | 80;
export type PrintFontScale = 1 | 2 | 3;
export type PrintFeedLines = 1 | 2 | 3;

export type KitchenTicketInput = {
  stallName: string;
  timeZone: string;
  order: {
    orderNo: string;
    fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
    tableLabel: string | null;
    note: string | null;
    createdAt: Date | string;
    scheduledPickupAt: Date | string | null;
    requestedFulfillmentAt: Date | string | null;
    committedFulfillmentAt: Date | string | null;
    items: Array<{
      name: string;
      quantity: number;
      note: string | null;
      noteOptions: Array<{ optionName: string }>;
    }>;
  };
  printedAt: Date;
  isReprint: boolean;
  paperWidthMm?: PrintPaperWidth;
  fontScale?: PrintFontScale;
  feedLines?: PrintFeedLines;
  showOrderNote?: boolean;
  showItemNotes?: boolean;
  sectionLabel?: string | null;
};

export const kitchenTicketPayloadSchema = z.object({
  kind: z.literal("KITCHEN_58MM_STARPRNT"),
  version: z.enum([KITCHEN_TICKET_TEMPLATE_VERSION_V1, KITCHEN_TICKET_TEMPLATE_VERSION]),
  mediaType: z.literal(KITCHEN_TICKET_MEDIA_TYPE),
  content: z.string().min(1),
  dataBase64: z.string().min(1),
}).strict();

export type KitchenTicketPayload = z.infer<typeof kitchenTicketPayloadSchema>;

export const customerReceiptPayloadSchema = z.object({
  kind: z.literal("CUSTOMER_RECEIPT_STARPRNT"),
  version: z.literal(CUSTOMER_RECEIPT_TEMPLATE_VERSION),
  mediaType: z.literal(KITCHEN_TICKET_MEDIA_TYPE),
  content: z.string().min(1),
  dataBase64: z.string().min(1),
}).strict();

export const printerTestPayloadSchema = z.object({
  kind: z.literal("PRINTER_TEST_STARPRNT"),
  version: z.literal(PRINTER_TEST_TEMPLATE_VERSION),
  mediaType: z.literal(KITCHEN_TICKET_MEDIA_TYPE),
  content: z.string().min(1),
  dataBase64: z.string().min(1),
}).strict();

export const printTicketPayloadSchema = z.union([
  kitchenTicketPayloadSchema,
  customerReceiptPayloadSchema,
  printerTestPayloadSchema,
]);

export type PrintTicketPayload = z.infer<typeof printTicketPayloadSchema>;

export function createKitchenTicketPayload(input: KitchenTicketInput): KitchenTicketPayload {
  const content = formatKitchenTicket(input);
  return {
    kind: "KITCHEN_58MM_STARPRNT",
    version: KITCHEN_TICKET_TEMPLATE_VERSION_V1,
    mediaType: KITCHEN_TICKET_MEDIA_TYPE,
    content,
    dataBase64: encodeStarPrnt(content, 1, 3).toString("base64"),
  };
}

export function kitchenTicketCommandBytes(payload: PrintTicketPayload) {
  return Uint8Array.from(Buffer.from(payload.dataBase64, "base64"));
}

export function createKitchenTicketBatchPayload(
  input: Omit<KitchenTicketInput, "order"> & {
    order: Omit<KitchenTicketInput["order"], "items">;
    sections: Array<{ label: string | null; items: KitchenTicketInput["order"]["items"] }>;
  },
  copies: number,
): KitchenTicketPayload {
  const paperWidthMm = input.paperWidthMm ?? 58;
  const fontScale = input.fontScale ?? 1;
  const contents: string[] = [];
  const commands: Buffer[] = [];
  for (let copy = 0; copy < copies; copy += 1) {
    for (const section of input.sections) {
      const content = formatKitchenTicket({
        ...input,
        order: { ...input.order, items: section.items },
        sectionLabel: section.label,
        paperWidthMm,
        fontScale,
      });
      contents.push(content);
      commands.push(encodeStarPrnt(content, fontScale, input.feedLines ?? 2));
    }
  }
  return {
    kind: "KITCHEN_58MM_STARPRNT",
    version: KITCHEN_TICKET_TEMPLATE_VERSION,
    mediaType: KITCHEN_TICKET_MEDIA_TYPE,
    content: contents.join("\n"),
    dataBase64: Buffer.concat(commands).toString("base64"),
  };
}

export type CustomerReceiptInput = {
  stallName: string;
  timeZone: string;
  currency: string;
  printedAt: Date;
  isReprint: boolean;
  paperWidthMm: PrintPaperWidth;
  fontScale: PrintFontScale;
  feedLines?: PrintFeedLines;
  showCustomerName?: boolean;
  showCustomerPhone?: boolean;
  showDeliveryAddress?: boolean;
  showOrderNote?: boolean;
  showItemNotes?: boolean;
  showPrices?: boolean;
  showPaymentMethod?: boolean;
  copies: number;
  order: {
    orderNo: string;
    fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
    tableLabel: string | null;
    customerName: string;
    customerPhone: string | null;
    deliveryAddress: string | null;
    note: string | null;
    createdAt: Date | string;
    subtotal: number;
    discountAmount: number;
    total: number;
    paymentStatus: "UNPAID" | "PAID" | "REFUNDED" | "PENDING_RECONCILIATION";
    paymentMethodLabel?: string | null;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      note: string | null;
      noteOptions: Array<{ optionName: string }>;
    }>;
  };
};

export function createCustomerReceiptPayload(input: CustomerReceiptInput): PrintTicketPayload {
  const content = formatCustomerReceipt(input);
  const contents = Array.from({ length: input.copies }, () => content);
  const commands = contents.map((copy) => encodeStarPrnt(copy, input.fontScale, input.feedLines ?? 2));
  return {
    kind: "CUSTOMER_RECEIPT_STARPRNT",
    version: CUSTOMER_RECEIPT_TEMPLATE_VERSION,
    mediaType: KITCHEN_TICKET_MEDIA_TYPE,
    content: contents.join("\n"),
    dataBase64: Buffer.concat(commands).toString("base64"),
  };
}

export function createPrinterTestPayload(input: {
  stallName: string;
  printerName: string;
  model: string;
  connectionLabel: string;
  paperWidthMm: PrintPaperWidth;
  printedAt: Date;
  timeZone: string;
}): PrintTicketPayload {
  const columns = printableColumns(input.paperWidthMm, 1);
  const lines = [
    fitLine("StallOrder｜測試列印", columns),
    divider(columns),
    fitLine(sanitizeText(input.stallName), columns),
    fitLine(`印表機：${sanitizeText(input.printerName)}`, columns),
    fitLine(`型號：${sanitizeText(input.model)}`, columns),
    fitLine(`連線：${sanitizeText(input.connectionLabel)}`, columns),
    fitLine(`紙寬：${input.paperWidthMm === 58 ? "57–58" : "80"} mm`, columns),
    fitLine(`時間：${formatMonthDayTime(input.printedAt, input.timeZone)}`, columns),
    divider(columns),
    fitLine("中文 English 123 ✓", columns),
    fitLine("若此行完整，列印模組可用。", columns),
  ];
  const content = `${lines.join("\n")}\n`;
  return {
    kind: "PRINTER_TEST_STARPRNT",
    version: PRINTER_TEST_TEMPLATE_VERSION,
    mediaType: KITCHEN_TICKET_MEDIA_TYPE,
    content,
    dataBase64: encodeStarPrnt(content, 1, 2).toString("base64"),
  };
}

function formatCustomerReceipt(input: CustomerReceiptInput) {
  const columns = printableColumns(input.paperWidthMm, input.fontScale);
  const lines: string[] = [];
  const order = input.order;
  const type = fulfillmentLabel(order.fulfillmentType);
  const table = order.fulfillmentType === "DINE_IN" && order.tableLabel
    ? ` 桌號${sanitizeText(order.tableLabel)}`
    : "";
  lines.push(fitLine(`${sanitizeText(input.stallName)}｜顧客明細`, columns));
  if (input.isReprint) lines.push(fitLine("*** 補印 ***", columns));
  lines.push(fitLine(`${type}${table} #${sanitizeText(order.orderNo).replace(/^#/, "")}`, columns));
  lines.push(fitLine(formatMonthDayTime(order.createdAt, input.timeZone), columns));
  if (input.showCustomerName !== false && order.customerName) {
    appendWrapped(lines, `顧客：${sanitizeText(order.customerName)}`, "", columns);
  }
  lines.push(divider(columns));
  for (const item of order.items) {
    if (input.showPrices === false) {
      appendWrapped(lines, `${item.quantity}× ${sanitizeText(item.name)}`, "", columns);
    } else {
      appendAmountLine(
        lines,
        `${item.quantity}× ${sanitizeText(item.name)}`,
        moneyLabel(item.unitPrice * item.quantity, input.currency),
        columns,
      );
    }
    if (input.showItemNotes !== false) {
      const details = [
        ...item.noteOptions.map((option) => sanitizeText(option.optionName)),
        ...(item.note ? [`★${sanitizeText(item.note)}`] : []),
      ].filter(Boolean);
      if (details.length > 0) appendWrapped(lines, details.join("／"), "   ", columns);
    }
  }
  if (input.showPrices !== false) {
    lines.push(divider(columns));
    appendAmountLine(lines, "小計", moneyLabel(order.subtotal, input.currency), columns);
    if (order.discountAmount > 0) {
      appendAmountLine(lines, "折扣", `-${moneyLabel(order.discountAmount, input.currency)}`, columns);
    }
    appendAmountLine(lines, "合計", moneyLabel(order.total, input.currency), columns);
  }
  if (input.showPaymentMethod !== false) {
    lines.push(fitLine(`付款：${sanitizeText(order.paymentMethodLabel ?? paymentLabel(order.paymentStatus))}`, columns));
  }
  if (input.showDeliveryAddress !== false && order.fulfillmentType === "DELIVERY" && order.deliveryAddress) {
    appendWrapped(lines, `地址：${sanitizeText(order.deliveryAddress)}`, "", columns);
  }
  if (input.showCustomerPhone !== false && order.customerPhone) appendWrapped(lines, `電話：${sanitizeText(order.customerPhone)}`, "", columns);
  if (input.showOrderNote !== false && order.note) appendWrapped(lines, `備註：${sanitizeText(order.note)}`, "", columns);
  lines.push(fitLine(`列印 ${formatTime(input.printedAt, input.timeZone)}`, columns));
  return `${lines.join("\n")}\n`;
}

export function formatKitchenTicket(input: KitchenTicketInput) {
  const lines: string[] = [];
  const order = input.order;
  const columns = printableColumns(input.paperWidthMm ?? 58, input.fontScale ?? 1);
  const fulfillmentAt = order.committedFulfillmentAt
    ?? order.requestedFulfillmentAt
    ?? order.scheduledPickupAt;
  const type = fulfillmentLabel(order.fulfillmentType);
  const orderNo = sanitizeText(order.orderNo).replace(/^#/, "");
  const table = order.fulfillmentType === "DINE_IN" && order.tableLabel
    ? ` 桌號${sanitizeText(order.tableLabel)}`
    : "";

  lines.push(fitLine(`${sanitizeText(input.stallName)}｜廚房製作單`, columns));
  if (input.isReprint) lines.push(fitLine("*** 補印 ***", columns));
  lines.push(fitLine(`${type}${table} #${orderNo}${fulfillmentAt ? " ★預約" : ""}`, columns));
  if (input.sectionLabel) lines.push(fitLine(`分單：${sanitizeText(input.sectionLabel)}`, columns));

  const createdTime = formatTime(order.createdAt, input.timeZone);
  if (fulfillmentAt) {
    const label = order.fulfillmentType === "DELIVERY" ? "送達" : "取餐";
    lines.push(fitLine(`${label} ${formatMonthDayTime(fulfillmentAt, input.timeZone)}｜下單 ${createdTime}`, columns));
  } else {
    lines.push(fitLine(`下單 ${formatMonthDayTime(order.createdAt, input.timeZone)}`, columns));
  }
  lines.push(divider(columns));

  for (const item of order.items) {
    appendWrapped(lines, `${item.quantity}× ${sanitizeText(item.name)}`, "", columns);
    if (input.showItemNotes !== false) {
      const details = [
        ...item.noteOptions.map((option) => sanitizeText(option.optionName)),
        ...(item.note ? [`★${sanitizeText(item.note)}`] : []),
      ].filter(Boolean);
      if (details.length > 0) appendWrapped(lines, details.join("／"), "   ", columns);
    }
  }

  lines.push(divider(columns));
  if (input.showOrderNote !== false && order.note) appendWrapped(lines, `備註：${sanitizeText(order.note)}`, "", columns);
  const totalQuantity = order.items.reduce((total, item) => total + item.quantity, 0);
  lines.push(fitLine(`共${order.items.length}品項／${totalQuantity}份｜列印${formatTime(input.printedAt, input.timeZone)}`, columns));
  return `${lines.join("\n")}\n`;
}

function fulfillmentLabel(type: KitchenTicketInput["order"]["fulfillmentType"]) {
  if (type === "DINE_IN") return "內用";
  if (type === "DELIVERY") return "外送";
  return "外帶自取";
}

function printableColumns(paperWidthMm: PrintPaperWidth, fontScale: PrintFontScale) {
  const columns = paperWidthMm === 80 ? KITCHEN_TICKET_80MM_COLUMNS : KITCHEN_TICKET_COLUMNS;
  return fontScale === 3 ? Math.floor(columns / 2) : columns;
}

function appendAmountLine(lines: string[], label: string, amount: string, columns: number) {
  const cleanLabel = sanitizeText(label);
  const cleanAmount = sanitizeText(amount);
  const spaces = columns - displayWidth(cleanLabel) - displayWidth(cleanAmount);
  if (spaces >= 1) {
    lines.push(`${cleanLabel}${" ".repeat(spaces)}${cleanAmount}`);
    return;
  }
  appendWrapped(lines, cleanLabel, "", columns);
  lines.push(fitLine(cleanAmount.padStart(Math.max(cleanAmount.length, columns - 2)), columns));
}

function moneyLabel(amount: number, currency: string) {
  const normalizedCurrency = sanitizeText(currency).toUpperCase();
  if (normalizedCurrency === "TWD") return `$${Math.round(amount).toLocaleString("en-US")}`;
  return `${normalizedCurrency} ${Math.round(amount).toLocaleString("en-US")}`;
}

function paymentLabel(status: CustomerReceiptInput["order"]["paymentStatus"]) {
  if (status === "PAID") return "已付款";
  if (status === "REFUNDED") return "已退款";
  if (status === "PENDING_RECONCILIATION") return "待核對";
  return "待結帳";
}

function appendWrapped(lines: string[], value: string, indent = "", columns = KITCHEN_TICKET_COLUMNS) {
  const firstWidth = columns - displayWidth(indent);
  const chunks = wrapByDisplayWidth(value, firstWidth);
  if (chunks.length === 0) return;
  lines.push(fitLine(`${indent}${chunks[0]}`, columns));
  for (const chunk of chunks.slice(1)) lines.push(fitLine(`${indent}${chunk}`, columns));
}

function wrapByDisplayWidth(value: string, maxWidth: number) {
  const chunks: string[] = [];
  let current = "";
  let width = 0;
  for (const character of Array.from(sanitizeText(value))) {
    const characterWidth = displayWidth(character);
    if (current && width + characterWidth > maxWidth) {
      chunks.push(current.trimEnd());
      current = "";
      width = 0;
    }
    current += character;
    width += characterWidth;
  }
  if (current) chunks.push(current.trimEnd());
  return chunks;
}

function fitLine(value: string, columns = KITCHEN_TICKET_COLUMNS) {
  const leadingSpaces = value.match(/^ */)?.[0] ?? "";
  const sanitized = `${leadingSpaces}${sanitizeText(value.slice(leadingSpaces.length))}`;
  if (displayWidth(sanitized) <= columns) return sanitized;
  const ellipsis = "…";
  let result = "";
  for (const character of Array.from(sanitized)) {
    if (displayWidth(result) + displayWidth(character) + displayWidth(ellipsis) > columns) break;
    result += character;
  }
  return `${result}${ellipsis}`;
}

export function displayWidth(value: string) {
  return Array.from(value).reduce((width, character) => width + (isWide(character) ? 2 : 1), 0);
}

function isWide(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function divider(columns = KITCHEN_TICKET_COLUMNS) {
  return "-".repeat(columns);
}

function sanitizeText(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeStarPrnt(content: string, fontScale: PrintFontScale, feedLines: PrintFeedLines) {
  const initialize = Buffer.from([0x1b, 0x40]);
  const enableUtf8 = Buffer.from([0x1b, 0x1d, 0x29, 0x55, 0x02, 0x00, 0x30, 0x01]);
  const useWideAmbiguousCharacters = Buffer.from([0x1b, 0x1d, 0x29, 0x55, 0x02, 0x00, 0x40, 0x01]);
  const preferTraditionalChinese = Buffer.from([
    0x1b, 0x1d, 0x29, 0x55, 0x05, 0x00, 0x41, 0x03, 0x02, 0x01, 0x04,
  ]);
  const magnification = fontScale === 3
    ? Buffer.from([0x1b, 0x69, 0x01, 0x01])
    : fontScale === 2
      ? Buffer.from([0x1b, 0x68, 0x01])
      : Buffer.alloc(0);
  const cancelMagnification = fontScale === 3
    ? Buffer.from([0x1b, 0x69, 0x00, 0x00])
    : fontScale === 2
      ? Buffer.from([0x1b, 0x68, 0x00])
      : Buffer.alloc(0);
  const feedAndPartialCut = Buffer.from([0x1b, 0x64, feedLines]);
  return Buffer.concat([
    initialize,
    enableUtf8,
    useWideAmbiguousCharacters,
    preferTraditionalChinese,
    magnification,
    Buffer.from(content, "utf8"),
    cancelMagnification,
    feedAndPartialCut,
  ]);
}

function formatMonthDayTime(value: Date | string, timeZone: string) {
  const parts = dateParts(value, timeZone);
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatTime(value: Date | string, timeZone: string) {
  const parts = dateParts(value, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function dateParts(value: Date | string, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}
