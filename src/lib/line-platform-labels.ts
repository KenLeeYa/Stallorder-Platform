export function platformOrderStatusLabel(status: string) {
  return ({ WAITING_CONFIRMATION: "等待店家確認", PENDING: "等待店家確認", CONFIRMED: "店家已確認", PREPARING: "餐點製作中", PACKING: "餐點打包中", READY: "餐點已完成", COMPLETED: "訂單已完成", CANCELLED: "訂單已取消", EXPIRED: "訂單已逾期" } as Record<string,string>)[status] ?? "處理中";
}
export function platformPaymentStatusLabel(status: string) {
  return ({ UNPAID: "尚未付款", PAID: "已付款", REFUNDED: "已退款" } as Record<string,string>)[status] ?? "付款待確認";
}
