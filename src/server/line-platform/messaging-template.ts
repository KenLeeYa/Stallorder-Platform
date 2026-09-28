import { z } from "zod";

export const platformNotificationEvents = ["ORDER_RECEIPT_AVAILABLE", "ORDER_READY", "ORDER_PICKED_UP", "ORDER_CANCELLED"] as const;
export type PlatformNotificationEvent = typeof platformNotificationEvents[number];
const inputSchema = z.object({
  event: z.enum(platformNotificationEvents), orderId: z.string().uuid(), orderNo: z.string().min(1).max(100),
  stallName: z.string().min(1).max(200), address: z.string().max(500), phone: z.string().max(100),
  total: z.number().int().nonnegative(), paymentStatus: z.string(), pickupCode: z.string().max(20).nullable(),
  createdAt: z.date(), fulfilledAt: z.date().nullable(), expectedAt: z.date().nullable(),
  endpointUrl: z.string().url(), liffId: z.string().regex(/^\d+-[A-Za-z0-9]+$/), imageUrl: z.string().url().nullable(),
});
export type PlatformTemplateInput = z.infer<typeof inputSchema>;
export function buildPlatformMessages(value: PlatformTemplateInput) {
  const input = inputSchema.parse(value);
  const origin = new URL(input.endpointUrl).origin;
  if (new URL(input.endpointUrl).protocol !== "https:" || (input.imageUrl && (new URL(input.imageUrl).origin !== origin || new URL(input.imageUrl).protocol !== "https:"))) throw new Error("PLATFORM_MESSAGE_URL_INVALID");
  const detailUrl = `https://miniapp.line.me/${input.liffId}/orders/${input.orderId}`;
  const status = input.event === "ORDER_READY" ? "餐點已完成，請取餐" : input.event === "ORDER_PICKED_UP" ? "已完成取餐" : input.event === "ORDER_CANCELLED" ? "訂單已取消" : "訂單已成立";
  const payment = input.paymentStatus === "PAID" ? "已付款" : input.paymentStatus === "REFUNDED" ? "已退款" : input.paymentStatus === "PENDING_RECONCILIATION" ? "付款待確認" : "尚未付款，請依訂單方式付款";
  const date = (v: Date) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(v);
  const text = (content: string, bold = false) => ({ type: "text", text: content, wrap: true, size: "sm", color: "#53635B", ...(bold ? { weight: "bold" } : {}) });
  const closed = input.event === "ORDER_PICKED_UP" || input.event === "ORDER_CANCELLED";
  const accent = input.event === "ORDER_CANCELLED" ? "#A63D35" : "#0F766E";
  const contents: Array<Record<string, unknown>> = [
    { ...text(input.stallName, true), color: accent },
    { ...text(status, true), size: "xl", color: "#183A35" },
    { type: "separator", margin: "lg", color: "#DBE5DF" },
    { type: "box", layout: "vertical", margin: "lg", spacing: "xs", contents: [
      text("取餐號碼"), { ...text(input.pickupCode ?? "請看訂單詳情", true), size: closed ? "xl" : "3xl", color: "#183A35" },
    ] },
    text(`訂單 ${input.orderNo}`),
    { ...text(`NT$${input.total} · ${payment}`, true), color: "#183A35" },
    text(`下單時間：${date(input.createdAt)}`),
  ];
  if (input.expectedAt && !closed) contents.push({ ...text(`預約／預估時間：${date(input.expectedAt)}（以餐點完成通知為準）`, true), color: accent });
  if (input.fulfilledAt && input.event === "ORDER_PICKED_UP") contents.push(text(`完成時間：${date(input.fulfilledAt)}`));
  if (input.address) contents.push(text(`取餐門市：${input.address}`));
  if (input.imageUrl && ["ORDER_RECEIPT_AVAILABLE", "ORDER_READY"].includes(input.event)) {
    contents.push({ type: "image", url: input.imageUrl, size: "full", aspectRatio: "1:1", aspectMode: "fit" });
    contents.push(text(input.event === "ORDER_READY" ? "餐點已完成，請出示此碼，由店員確認交付。" : "請於餐點完成後，出示此碼取餐。"));
  }
  contents.push({ ...text("本卡為通知當時快照；最新狀態與 QR 效期請查看訂單。"), size: "xs" });
  const buttons: Array<Record<string, unknown>> = [{ type: "button", style: "primary", color: "#0F766E", action: { type: "uri", label: closed ? "查看訂單" : "查看訂單／取餐碼", uri: detailUrl } }];
  if (/^\+?[0-9 ()-]{6,30}$/.test(input.phone)) buttons.push({ type: "button", action: { type: "uri", label: "聯絡店家", uri: `tel:${input.phone.replace(/[ ()-]/g, "")}` } });
  else buttons.push({ type: "button", action: { type: "uri", label: "店家聯絡資訊", uri: detailUrl } });
  return [{ type: "flex", altText: `${input.stallName}｜${input.orderNo}｜${status}`.slice(0, 400), contents: { type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#EEF5F2", paddingAll: "lg", contents: [{ ...text("攤點通 QIDAIGO", true), size: "xs", color: "#0F766E" }] },
    body: { type: "box", layout: "vertical", backgroundColor: "#FFFFFF", paddingAll: "xl", spacing: "md", contents },
    footer: { type: "box", layout: "vertical", backgroundColor: "#FFFFFF", spacing: "sm", paddingAll: "lg", contents: buttons } } }];
}
