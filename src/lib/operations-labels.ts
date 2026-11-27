// Serializable label subsets; canonical strings stay in their existing server owners.
export const authorityLabelKeys = [
  "權限或登入狀態已變更。請重新整理後繼續。",
  "重新整理"
] as const;
export type AuthorityLabels = Record<typeof authorityLabelKeys[number], string>;
export const readLabelKeys = [
  "目前離線；顯示的資料可能已過期。",
  "最後讀取：{time}",
  "尚未讀取資料。",
  "資料格式不符，請重新整理。",
  "無法連線，請稍後重試。",
  "讀取暫時受限。",
  "讀取失敗，請重新整理。",
  "請等待 {seconds} 秒。",
  "重試",
  "重新整理",
  "上一頁",
  "下一頁",
  "每頁"
] as const;
export type ReadLabels = Record<typeof readLabelKeys[number], string>;
export const catalogLabelKeys = [
  "商品",
  "價格",
  "狀態",
  "啟用",
  "停用",
  "操作",
  "編輯",
  "返回商品清單",
  "載入完整商品管理…",
  "共用商品",
  "搜尋商品",
  "全部",
  "排序",
  "目錄順序",
  "名稱遞增",
  "名稱遞減",
  "完整管理／新增商品",
  "重新整理",
  "載入商品…",
  "共 {count} 項商品",
  " · 更新中…",
  "授權組織商品清單",
  "沒有符合條件的商品。",
  "清除篩選",
  "上一頁",
  "下一頁",
  "每頁",
  "每頁商品數"
] as const;
export type CatalogLabels = Record<typeof catalogLabelKeys[number], string>;
export const historyLabelKeys = [
  "reports.orders.list.order",
  "reports.orders.list.time",
  "reports.orders.list.status",
  "reports.orders.list.fulfillment",
  "reports.orders.list.total",
  "reports.orders.list.actions",
  "reports.orders.list.details",
  "reports.orders.list.rowGone",
  "reports.orders.list.list",
  "reports.orders.list.lag",
  "reports.orders.list.sort",
  "reports.orders.list.newest",
  "reports.orders.list.oldest",
  "reports.orders.list.loading",
  "reports.orders.list.count",
  "reports.orders.list.updating",
  "reports.orders.none",
  "reports.orders.list.detail",
  "reports.orders.list.close",
  "reports.orders.list.loadingDetail",
  "reports.orders.unpaid",
  "reports.orders.status.waiting",
  "reports.orders.status.confirmed",
  "reports.orders.status.preparing",
  "reports.orders.status.packing",
  "reports.orders.status.ready",
  "reports.orders.status.completed",
  "reports.orders.status.cancelled",
  "reports.orders.status.expired",
  "reports.orders.fulfillment.takeout",
  "reports.orders.fulfillment.dineIn",
  "reports.orders.fulfillment.delivery"
] as const;
export type HistoryLabels = Record<typeof historyLabelKeys[number], string>;
