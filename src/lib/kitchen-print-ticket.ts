import { z } from "zod";

export const KITCHEN_TICKET_COLUMNS = 32;
export const KITCHEN_TICKET_TEMPLATE_VERSION = "kitchen-58mm-starprnt-v1";
export const KITCHEN_TICKET_MEDIA_TYPE = "application/vnd.star.starprnt";

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
};

export const kitchenTicketPayloadSchema = z.object({
  kind: z.literal("KITCHEN_58MM_STARPRNT"),
  version: z.literal(KITCHEN_TICKET_TEMPLATE_VERSION),
  mediaType: z.literal(KITCHEN_TICKET_MEDIA_TYPE),
  content: z.string().min(1),
  dataBase64: z.string().min(1),
}).strict();

export type KitchenTicketPayload = z.infer<typeof kitchenTicketPayloadSchema>;

export function createKitchenTicketPayload(input: KitchenTicketInput): KitchenTicketPayload {
  const content = formatKitchenTicket(input);
  return {
    kind: "KITCHEN_58MM_STARPRNT",
    version: KITCHEN_TICKET_TEMPLATE_VERSION,
    mediaType: KITCHEN_TICKET_MEDIA_TYPE,
    content,
    dataBase64: encodeStarPrnt(content).toString("base64"),
  };
}

export function kitchenTicketCommandBytes(payload: KitchenTicketPayload) {
  return Uint8Array.from(Buffer.from(payload.dataBase64, "base64"));
}

export function formatKitchenTicket(input: KitchenTicketInput) {
  const lines: string[] = [];
  const order = input.order;
  const fulfillmentAt = order.committedFulfillmentAt
    ?? order.requestedFulfillmentAt
    ?? order.scheduledPickupAt;
  const type = fulfillmentLabel(order.fulfillmentType);
  const orderNo = sanitizeText(order.orderNo).replace(/^#/, "");
  const table = order.fulfillmentType === "DINE_IN" && order.tableLabel
    ? ` 桌號${sanitizeText(order.tableLabel)}`
    : "";

  lines.push(fitLine(`${sanitizeText(input.stallName)}｜廚房製作單`));
  if (input.isReprint) lines.push(fitLine("*** 補印 ***"));
  lines.push(fitLine(`${type}${table} #${orderNo}${fulfillmentAt ? " ★預約" : ""}`));

  const createdTime = formatTime(order.createdAt, input.timeZone);
  if (fulfillmentAt) {
    const label = order.fulfillmentType === "DELIVERY" ? "送達" : "取餐";
    lines.push(fitLine(`${label} ${formatMonthDayTime(fulfillmentAt, input.timeZone)}｜下單 ${createdTime}`));
  } else {
    lines.push(fitLine(`下單 ${formatMonthDayTime(order.createdAt, input.timeZone)}`));
  }
  lines.push(divider());

  for (const item of order.items) {
    appendWrapped(lines, `${item.quantity}× ${sanitizeText(item.name)}`);
    const details = [
      ...item.noteOptions.map((option) => sanitizeText(option.optionName)),
      ...(item.note ? [`★${sanitizeText(item.note)}`] : []),
    ].filter(Boolean);
    if (details.length > 0) appendWrapped(lines, details.join("／"), "   ");
  }

  lines.push(divider());
  if (order.note) appendWrapped(lines, `備註：${sanitizeText(order.note)}`);
  const totalQuantity = order.items.reduce((total, item) => total + item.quantity, 0);
  lines.push(fitLine(`共${order.items.length}品項／${totalQuantity}份｜列印${formatTime(input.printedAt, input.timeZone)}`));
  return `${lines.join("\n")}\n`;
}

function fulfillmentLabel(type: KitchenTicketInput["order"]["fulfillmentType"]) {
  if (type === "DINE_IN") return "內用";
  if (type === "DELIVERY") return "外送";
  return "外帶自取";
}

function appendWrapped(lines: string[], value: string, indent = "") {
  const firstWidth = KITCHEN_TICKET_COLUMNS - displayWidth(indent);
  const chunks = wrapByDisplayWidth(value, firstWidth);
  if (chunks.length === 0) return;
  lines.push(fitLine(`${indent}${chunks[0]}`));
  for (const chunk of chunks.slice(1)) lines.push(fitLine(`${indent}${chunk}`));
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

function fitLine(value: string) {
  const leadingSpaces = value.match(/^ */)?.[0] ?? "";
  const sanitized = `${leadingSpaces}${sanitizeText(value.slice(leadingSpaces.length))}`;
  if (displayWidth(sanitized) <= KITCHEN_TICKET_COLUMNS) return sanitized;
  const ellipsis = "…";
  let result = "";
  for (const character of Array.from(sanitized)) {
    if (displayWidth(result) + displayWidth(character) + displayWidth(ellipsis) > KITCHEN_TICKET_COLUMNS) break;
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

function divider() {
  return "-".repeat(KITCHEN_TICKET_COLUMNS);
}

function sanitizeText(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeStarPrnt(content: string) {
  const initialize = Buffer.from([0x1b, 0x40]);
  const enableUtf8 = Buffer.from([0x1b, 0x1d, 0x29, 0x55, 0x02, 0x00, 0x30, 0x01]);
  const useWideAmbiguousCharacters = Buffer.from([0x1b, 0x1d, 0x29, 0x55, 0x02, 0x00, 0x40, 0x01]);
  const preferTraditionalChinese = Buffer.from([
    0x1b, 0x1d, 0x29, 0x55, 0x05, 0x00, 0x41, 0x03, 0x02, 0x01, 0x04,
  ]);
  const feedAndPartialCut = Buffer.from([0x1b, 0x64, 0x03]);
  return Buffer.concat([
    initialize,
    enableUtf8,
    useWideAmbiguousCharacters,
    preferTraditionalChinese,
    Buffer.from(content, "utf8"),
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
