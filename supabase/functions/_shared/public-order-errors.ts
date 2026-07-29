export function errorMessage(code: string) {
  const deliveryMessages: Record<string, string> = {
    DELIVERY_UNAVAILABLE: "目前未開放線上外送。",
    INVALID_DELIVERY_DETAILS: "請填寫有效的聯絡電話與外送地址。",
    ORDER_MODE_CONFLICT: "點餐連結與訂購方式不相符，請重新開啟正確連結。",
  };
  if (deliveryMessages[code]) return deliveryMessages[code];
  const messages: Record<string, string> = {
    ORIGIN_NOT_ALLOWED: "不允許此網站送出訂單。",
    METHOD_NOT_ALLOWED: "不支援此請求方式。",
    REQUEST_TOO_LARGE: "請求內容過大。",
    INVALID_JSON: "請求格式不正確。",
    INVALID_REQUEST: "訂單資料不正確。",
    CLIENT_VERSION_UNSUPPORTED: "點餐頁面版本已更新，請重新整理後再試。",
    REQUEST_SOURCE_UNAVAILABLE: "目前無法驗證連線來源，請稍後再試。",
    CIRCUIT_B_UNAVAILABLE: "備援點餐路徑目前未開放。",
    QR_NOT_FOUND: "找不到此 QR Code。",
    QR_REVOKED: "此 QR Code 已撤銷。",
    QR_PAUSED: "此 QR Code 已暫停接單。",
    QR_EXPIRED: "此 QR Code 已過期。",
    QR_NOT_ACTIVE: "此 QR Code 目前無法使用。",
    TABLE_UNAVAILABLE: "此內用桌位目前無法點餐。",
    QR_SESSION_MISMATCH: "點餐連結與 Session 不相符，請重新掃描。",
    STALL_CLOSED: "攤位目前已關閉點餐。",
    ORDERING_PAUSED: "攤位目前暫停接單。",
    STALL_SOLD_OUT: "攤位商品目前已售完。",
    TENANT_INACTIVE: "商戶目前無法接單。",
    SESSION_NOT_FOUND: "找不到點餐 Session，請重新掃描。",
    SESSION_EXPIRED: "點餐 Session 已過期，請重新掃描。",
    SESSION_REPLAYED: "此點餐 Session 已使用，無法再次下單。",
    SESSION_DEVICE_MISMATCH: "點餐 Session 無法在此裝置使用。",
    RATE_LIMITED: "操作過於頻繁，請稍後再試。",
    INVALID_TURNSTILE: "安全驗證失敗，請重新完成驗證。",
    TURNSTILE_UNAVAILABLE: "安全驗證暫時無法使用，請稍後再試。",
    INVALID_ITEMS: "請至少選擇一項商品。",
    TOO_MANY_OR_DUPLICATE_PRODUCTS: "商品種類過多或有重複商品。",
    EXCESSIVE_TOTAL_QUANTITY: "訂單總數量超過攤位限制。",
    EXCESSIVE_ITEM_QUANTITY: "單項商品數量超過攤位限制。",
    NOTE_TOO_LONG: "備註內容超過攤位限制。",
    PRODUCT_UNAVAILABLE: "部分商品已售完或無法供應。",
    INVALID_PRODUCT_NOTES: "商品註記已變更或選取不完整，請重新確認。",
    TOO_MANY_PENDING_ORDERS: "此裝置尚有過多待確認訂單。",
    CAPACITY_PAUSED: "目前訂單較多，已暫停接受公開點餐。",
    PRODUCT_CAPACITY_EXCEEDED: "部分商品在目前時段已達供應上限，請調整數量。",
    LOCATION_UNAVAILABLE: "此出攤地點目前無法使用。",
    EVENT_NOT_ACTIVE: "此市集活動尚未開始或目前無法接單。",
    EVENT_EXPIRED: "此市集活動已結束，請查看最新出攤行程。",
    SCHEDULE_NOT_ACTIVE: "此出攤行程尚未開放點餐。",
    SCHEDULE_CLOSED: "此出攤行程已停止接單。",
    SCHEDULE_CONTEXT_MISMATCH: "點餐行程已變更，請重新掃描 QR Code。",
    WAIT_ACKNOWLEDGMENT_REQUIRED: "請先確認目前預估等候時間。",
    ORDER_CONFLICT: "訂單發生衝突，請重新掃描後再試。",
    ORDER_CREATE_ERROR: "目前無法建立訂單，請稍後再試。",
    ORDER_NOT_FOUND: "找不到此訂單。",
    LINE_LINK_UNAVAILABLE: "此商家目前未開放 LINE 取餐通知。",
    LINE_LINK_EXPIRED: "LINE 綁定已逾時，請重新操作。",
    LINE_LINK_CONFLICT: "LINE 綁定狀態已變更，請重新操作。",
    REORDER_UNAVAILABLE: "此商家目前未開放再次點餐。",
    FEATURE_NOT_INCLUDED: "目前方案未包含此功能，請聯絡商家確認服務方案。",
    PLAN_LIMIT_REACHED: "目前方案的使用上限已達，請聯絡商家處理。",
    SUBSCRIPTION_NOT_ACTIVE: "商家訂閱目前不可使用，請稍後再試。",
    SUBSCRIPTION_SUSPENDED: "商家訂閱目前已停權，暫時無法接受新訂單。",
    TRIAL_EXPIRED: "商家試用期已結束，暫時無法接受新訂單。",
    TRIAL_ORDER_LIMIT_REACHED: "商家試用訂單額度已用完，暫時無法接受新訂單。",
    ADDITIONAL_STALL_APPROVAL_REQUIRED: "商家尚未完成攤位額度核准。",
    ORDER_PACKAGE_REQUIRED: "商家目前無法接受更多訂單，請稍後再試。",
    UPGRADE_REQUIRED: "商家目前方案無法使用此服務。",
  };
  return messages[code] ?? "目前無法處理此操作。";
}

export function statusForCode(code: string) {
  if (["QR_NOT_FOUND", "SESSION_NOT_FOUND", "ORDER_NOT_FOUND"].includes(code)) return 404;
  if (["QR_REVOKED", "QR_PAUSED", "QR_EXPIRED", "QR_NOT_ACTIVE", "QR_SESSION_MISMATCH", "STALL_CLOSED", "ORDERING_PAUSED", "STALL_SOLD_OUT", "TENANT_INACTIVE", "SESSION_EXPIRED", "SESSION_REPLAYED", "SESSION_DEVICE_MISMATCH", "DELIVERY_UNAVAILABLE", "ORDER_MODE_CONFLICT", "CAPACITY_PAUSED", "PRODUCT_CAPACITY_EXCEEDED", "LOCATION_UNAVAILABLE", "EVENT_NOT_ACTIVE", "EVENT_EXPIRED", "SCHEDULE_NOT_ACTIVE", "SCHEDULE_CLOSED", "SCHEDULE_CONTEXT_MISMATCH"].includes(code)) return 409;
  if (code === "RATE_LIMITED" || code === "TOO_MANY_PENDING_ORDERS") return 429;
  if (code === "TURNSTILE_UNAVAILABLE") return 503;
  if (code === "REQUEST_SOURCE_UNAVAILABLE" || code === "CIRCUIT_B_UNAVAILABLE") return 503;
  if (code === "CLIENT_VERSION_UNSUPPORTED") return 426;
  if (["ORDER_CONFLICT"].includes(code)) return 409;
  if (["FEATURE_NOT_INCLUDED", "SUBSCRIPTION_NOT_ACTIVE", "SUBSCRIPTION_SUSPENDED", "TRIAL_EXPIRED", "UPGRADE_REQUIRED", "LINE_LINK_UNAVAILABLE", "REORDER_UNAVAILABLE"].includes(code)) return 403;
  if (["PLAN_LIMIT_REACHED", "TRIAL_ORDER_LIMIT_REACHED", "ADDITIONAL_STALL_APPROVAL_REQUIRED", "ORDER_PACKAGE_REQUIRED"].includes(code)) return 409;
  if (["INVALID_PRODUCT_NOTES", "INVALID_DELIVERY_DETAILS", "WAIT_ACKNOWLEDGMENT_REQUIRED"].includes(code)) return 422;
  if (["ORDER_CREATE_ERROR"].includes(code)) return 500;
  return 400;
}
